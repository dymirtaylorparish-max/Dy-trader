import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// ================= CONFIG =================
const SYMBOL_CONFIG = {
  NQ: { displayName: "Nasdaq Futures", basePrice: 18250, tickSize: 0.25, tickValue: 5 },
  ES: { displayName: "S&P 500 Futures", basePrice: 5285, tickSize: 0.25, tickValue: 12.5 },
  CL: { displayName: "Crude Oil Futures", basePrice: 77.2, tickSize: 0.01, tickValue: 10 },
  GC: { displayName: "Gold Futures", basePrice: 2337, tickSize: 0.1, tickValue: 10 },
};

const SESSION_RULES = {
  Tokyo: {
    minMovePct: 0.08,
    emaSpreadFactor: 0.00012,
    vwapDistanceFactor: 0.00008,
    preferredSymbols: ["GC", "CL"],
    killZone: "19:00–22:00 ET",
    sessionWindow: "19:00–04:00 ET",
  },
  London: {
    minMovePct: 0.12,
    emaSpreadFactor: 0.00018,
    vwapDistanceFactor: 0.00012,
    preferredSymbols: ["GC", "CL", "ES"],
    killZone: "02:00–05:00 ET",
    sessionWindow: "03:00–12:00 ET",
  },
  "New York": {
    minMovePct: 0.18,
    emaSpreadFactor: 0.00022,
    vwapDistanceFactor: 0.00016,
    preferredSymbols: ["NQ", "ES", "CL", "GC"],
    killZone: "08:30–11:00 ET",
    sessionWindow: "08:00–17:00 ET",
  },
};

// ================= STATE =================
const brokerState = {
  connected: false,
  mode: "DEMO",
  apiKey: "",
  apiSecret: "",
  accountLabel: "Not Connected",
};

const demoAccount = {
  id: "DEMO1717497",
  nickname: "Demo",
  netLiquidity: 50000,
  marginAvailable: 50000,
  openPnl: 0,
  realizedPnl: 0,
  cashBalance: 50000,
  canTrade: true,
  permissions: ["futures", "sim"],
  dailyLossLimit: 1500,
  riskPerTrade: 300,
};

const orders = [];
const positions = [];

// ================= HELPERS =================
function roundTo(value, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function ema(values, period) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i += 1) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

function makeSimCandles(basePrice, symbol, timeframe = "5m") {
  const candles = [];
  let price = basePrice;

  const tfMultiplier =
    timeframe === "1h" ? 2.6 : timeframe === "15m" ? 1.6 : 1;

  for (let i = 0; i < 40; i += 1) {
    const variance =
      symbol === "CL"
        ? (Math.random() - 0.5) * 0.8 * tfMultiplier
        : (Math.random() - 0.5) * 20 * tfMultiplier;

    const open = price;
    const close = roundTo(open + variance, 2);
    const high = roundTo(Math.max(open, close) + Math.abs(variance) * 0.3, 2);
    const low = roundTo(Math.min(open, close) - Math.abs(variance) * 0.3, 2);
    const volume = Math.floor(300 + Math.random() * 2000);

    candles.push({ open, high, low, close, volume });
    price = close;
  }

  return candles;
}

function vwapFromCandles(candles) {
  let pv = 0;
  let volumeTotal = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    pv += typicalPrice * c.volume;
    volumeTotal += c.volume;
  }

  if (!volumeTotal) return candles[candles.length - 1]?.close || 0;
  return pv / volumeTotal;
}

function getSessionRule(sessionName) {
  return SESSION_RULES[sessionName] || SESSION_RULES["New York"];
}

function getVolatilityLabel(movePctAbs, sessionRule) {
  if (movePctAbs >= sessionRule.minMovePct * 2.2) return "High";
  if (movePctAbs >= sessionRule.minMovePct) return "Normal";
  return "Low";
}

function signalFromStructure(price, ema9Value, ema21Value, vwapValue) {
  if (ema9Value > ema21Value && price > vwapValue) return "BUY";
  if (ema9Value < ema21Value && price < vwapValue) return "SELL";
  return "NO TRADE";
}

function buildTimeframeData(symbol, timeframe, sessionName) {
  const config = SYMBOL_CONFIG[symbol];
  const candles = makeSimCandles(config.basePrice, symbol, timeframe);
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const prevClose = closes[0];
  const ema9Value = ema(closes.slice(-20), 9);
  const ema21Value = ema(closes.slice(-30), 21);
  const vwapValue = vwapFromCandles(candles);
  const movePct = roundTo(((price - prevClose) / prevClose) * 100, 2);
  const sessionHigh = roundTo(Math.max(...closes), 2);
  const sessionLow = roundTo(Math.min(...closes), 2);

  return {
    timeframe,
    price: roundTo(price, 2),
    ema9: roundTo(ema9Value, 2),
    ema21: roundTo(ema21Value, 2),
    vwap: roundTo(vwapValue, 2),
    movePct,
    signal: signalFromStructure(price, ema9Value, ema21Value, vwapValue),
    sessionHigh,
    sessionLow,
    session: sessionName,
  };
}

function buildSessionLogic({
  symbol,
  price,
  ema9,
  ema21,
  vwap,
  movePct,
  sessionName,
  mtf,
}) {
  const sessionRule = getSessionRule(sessionName);
  const moveAbs = Math.abs(movePct);
  const emaSpread = Math.abs(ema9 - ema21);
  const vwapDistance = Math.abs(price - vwap);

  const minEmaSpread = price * sessionRule.emaSpreadFactor;
  const minVwapDistance = price * sessionRule.vwapDistanceFactor;
  const preferred = sessionRule.preferredSymbols.includes(symbol);

  let signal = "NO TRADE";
  let bias = "Neutral";
  let note = "No clean setup right now.";

  const longTrend = ema9 > ema21 && price > vwap;
  const shortTrend = ema9 < ema21 && price < vwap;
  const enoughMove = moveAbs >= sessionRule.minMovePct;
  const enoughStructure = emaSpread >= minEmaSpread && vwapDistance >= minVwapDistance;

  const tfSignals = [mtf["5m"].signal, mtf["15m"].signal, mtf["1h"].signal];
  const buyAgreement = tfSignals.filter((s) => s === "BUY").length;
  const sellAgreement = tfSignals.filter((s) => s === "SELL").length;
  const agreementScore = Math.max(buyAgreement, sellAgreement);

  if (longTrend) bias = "Bullish";
  if (shortTrend) bias = "Bearish";

  if (longTrend && enoughMove && enoughStructure && buyAgreement >= 2) {
    signal = preferred ? "BUY" : "NO TRADE";
    note =
      signal === "BUY"
        ? `${sessionName} long setup confirmed by ${buyAgreement}/3 timeframes.`
        : `Bullish structure exists, but ${symbol} is not a priority contract for ${sessionName}.`;
  } else if (shortTrend && enoughMove && enoughStructure && sellAgreement >= 2) {
    signal = preferred ? "SELL" : "NO TRADE";
    note =
      signal === "SELL"
        ? `${sessionName} short setup confirmed by ${sellAgreement}/3 timeframes.`
        : `Bearish structure exists, but ${symbol} is not a priority contract for ${sessionName}.`;
  } else if (Math.max(buyAgreement, sellAgreement) < 2) {
    note = `Multi-timeframe agreement is weak. Need at least 2 of 3 timeframes aligned.`;
  } else if (moveAbs < sessionRule.minMovePct) {
    note = `${sessionName} move is too small. Waiting for stronger expansion.`;
  } else if (emaSpread < minEmaSpread) {
    note = `${sessionName} EMA spread is too tight. Trend confirmation is weak.`;
  } else if (vwapDistance < minVwapDistance) {
    note = `${sessionName} price is too close to VWAP. No edge yet.`;
  }

  return {
    signal,
    bias,
    note,
    volatility: getVolatilityLabel(moveAbs, sessionRule),
    preferred,
    agreementScore,
    killZone: sessionRule.killZone,
    sessionWindow: sessionRule.sessionWindow,
  };
}

function getMarketData(symbol, sessionName = "New York") {
  const config = SYMBOL_CONFIG[symbol];
  if (!config) return null;

  const tf5 = buildTimeframeData(symbol, "5m", sessionName);
  const tf15 = buildTimeframeData(symbol, "15m", sessionName);
  const tf1h = buildTimeframeData(symbol, "1h", sessionName);

  const logic = buildSessionLogic({
    symbol,
    price: tf5.price,
    ema9: tf5.ema9,
    ema21: tf5.ema21,
    vwap: tf5.vwap,
    movePct: tf5.movePct,
    sessionName,
    mtf: {
      "5m": tf5,
      "15m": tf15,
      "1h": tf1h,
    },
  });

  return {
    symbol,
    displayName: config.displayName,
    price: tf5.price,
    ema9: tf5.ema9,
    ema21: tf5.ema21,
    vwap: tf5.vwap,
    prevClose: roundTo(tf5.price / (1 + tf5.movePct / 100), 2),
    movePct: tf5.movePct,
    session: sessionName,
    signal: logic.signal,
    bias: logic.bias,
    note: logic.note,
    volatility: logic.volatility,
    preferred: logic.preferred,
    sessionHigh: tf5.sessionHigh,
    sessionLow: tf5.sessionLow,
    tickSize: config.tickSize,
    tickValue: config.tickValue,
    provider: "server-sim",
    timestamp: new Date().toISOString(),
    agreementScore: logic.agreementScore,
    killZone: logic.killZone,
    sessionWindow: logic.sessionWindow,
    mtf: {
      "5m": tf5,
      "15m": tf15,
      "1h": tf1h,
    },
  };
}

function recalcAccount() {
  let openPnl = 0;
  for (const p of positions) {
    openPnl += Number(p.pnl || 0);
  }

  demoAccount.openPnl = roundTo(openPnl, 2);
  demoAccount.marginAvailable = roundTo(
    Math.max(0, demoAccount.netLiquidity + demoAccount.realizedPnl + demoAccount.openPnl),
    2
  );
  demoAccount.cashBalance = roundTo(demoAccount.netLiquidity + demoAccount.realizedPnl, 2);
}

// ================= ROUTES =================
app.get("/", (_req, res) => {
  res.send("Dy Trader API is running");
});

app.get("/api/futures", (req, res) => {
  const symbol = String(req.query.symbol || "NQ").toUpperCase();
  const session = String(req.query.session || "New York");
  const data = getMarketData(symbol, session);

  if (!data) {
    return res.status(400).json({
      error: "Unsupported symbol",
      supported: Object.keys(SYMBOL_CONFIG),
    });
  }

  res.json(data);
});

app.get("/api/scanner", (req, res) => {
  const session = String(req.query.session || "New York");
  const signal = String(req.query.signal || "ALL").toUpperCase();
  const volatility = String(req.query.volatility || "ALL");
  const preferredOnly = String(req.query.preferredOnly || "false") === "true";
  const symbolsParam = String(req.query.symbols || "").trim();

  let results = Object.keys(SYMBOL_CONFIG).map((symbol) => getMarketData(symbol, session));

  if (symbolsParam) {
    const allowed = symbolsParam
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    results = results.filter((item) => allowed.includes(item.symbol));
  }

  if (signal !== "ALL") {
    results = results.filter((item) => item.signal === signal);
  }

  if (volatility !== "ALL") {
    results = results.filter((item) => item.volatility === volatility);
  }

  if (preferredOnly) {
    results = results.filter((item) => item.preferred);
  }

  results = results.sort((a, b) => {
    const aScore =
      (a.preferred ? 3 : 0) +
      (a.signal === "BUY" || a.signal === "SELL" ? 3 : 0) +
      (a.volatility === "High" ? 2 : a.volatility === "Normal" ? 1 : 0) +
      Number(a.agreementScore || 0) * 2 +
      Math.abs(Number(a.movePct || 0));

    const bScore =
      (b.preferred ? 3 : 0) +
      (b.signal === "BUY" || b.signal === "SELL" ? 3 : 0) +
      (b.volatility === "High" ? 2 : b.volatility === "Normal" ? 1 : 0) +
      Number(b.agreementScore || 0) * 2 +
      Math.abs(Number(b.movePct || 0));

    return bScore - aScore;
  });

  res.json(results);
});

app.get("/api/broker", (_req, res) => {
  res.json(brokerState);
});

app.post("/api/broker/connect", (req, res) => {
  const { apiKey, apiSecret, mode } = req.body || {};

  brokerState.connected = true;
  brokerState.apiKey = apiKey || "";
  brokerState.apiSecret = apiSecret || "";
  brokerState.mode = mode === "LIVE" ? "LIVE" : "DEMO";
  brokerState.accountLabel =
    brokerState.mode === "LIVE" ? "Live Account Connected" : "Demo Account Connected";

  res.json({ ok: true, broker: brokerState });
});

app.post("/api/broker/disconnect", (_req, res) => {
  brokerState.connected = false;
  brokerState.apiKey = "";
  brokerState.apiSecret = "";
  brokerState.mode = "DEMO";
  brokerState.accountLabel = "Not Connected";
  res.json({ ok: true, broker: brokerState });
});

app.get("/api/accounts", (_req, res) => {
  recalcAccount();
  res.json([
    {
      id: demoAccount.id,
      nickname: demoAccount.nickname,
      netLiquidity: demoAccount.netLiquidity,
      marginAvailable: demoAccount.marginAvailable,
      openPnl: demoAccount.openPnl,
      realizedPnl: demoAccount.realizedPnl,
      cashBalance: demoAccount.cashBalance,
      canTrade: demoAccount.canTrade,
      permissions: demoAccount.permissions,
      mode: brokerState.mode,
      dailyLossLimit: demoAccount.dailyLossLimit,
      riskPerTrade: demoAccount.riskPerTrade,
    },
  ]);
});

app.get("/api/orders", (_req, res) => {
  res.json(orders);
});

app.post("/api/orders", (req, res) => {
  const {
    symbol,
    side,
    qty,
    orderType,
    limitPrice,
    stopLoss,
    takeProfit,
    session,
    riskAmount,
    stopTicks,
    targetTicks,
    rr,
  } = req.body || {};

  if (!SYMBOL_CONFIG[symbol]) {
    return res.status(400).json({ error: "Unsupported symbol" });
  }

  const market = getMarketData(symbol, session || "New York");
  const now = new Date().toISOString();

  const order = {
    id: `ord_${Date.now()}`,
    symbol,
    side,
    qty: Number(qty || 1),
    orderType: orderType || "MARKET",
    limitPrice: limitPrice || "",
    stopLoss: stopLoss || "",
    takeProfit: takeProfit || "",
    riskAmount: Number(riskAmount || 0),
    stopTicks: Number(stopTicks || 0),
    targetTicks: Number(targetTicks || 0),
    rr: Number(rr || 0),
    status: "FILLED",
    fillPrice: market?.price ?? "",
    timestamp: now,
    mode: brokerState.mode,
    session: session || "New York",
  };

  orders.unshift(order);

  positions.unshift({
    id: `pos_${Date.now()}`,
    symbol,
    side,
    qty: Number(qty || 1),
    entryPrice: Number(market?.price || 0),
    currentPrice: Number(market?.price || 0),
    pnl: 0,
    timestamp: now,
    mode: brokerState.mode,
    session: session || "New York",
  });

  recalcAccount();
  res.json({ ok: true, order });
});

app.get("/api/positions", (_req, res) => {
  const updated = positions.map((p) => {
    const market = getMarketData(p.symbol, p.session || "New York");
    const currentPrice = Number(market?.price ?? p.currentPrice);
    const multiplier = p.side === "BUY" ? 1 : -1;
    const pnl = roundTo((currentPrice - p.entryPrice) * p.qty * multiplier, 2);

    return {
      ...p,
      currentPrice,
      pnl,
    };
  });

  positions.length = 0;
  positions.push(...updated);
  recalcAccount();
  res.json(updated);
});

app.post("/api/positions/flatten", (req, res) => {
  const { id } = req.body || {};
  const idx = positions.findIndex((p) => p.id === id);

  if (idx === -1) {
    return res.status(404).json({ error: "Position not found" });
  }

  const pos = positions[idx];
  demoAccount.realizedPnl = roundTo(demoAccount.realizedPnl + Number(pos.pnl || 0), 2);
  positions.splice(idx, 1);
  recalcAccount();

  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
