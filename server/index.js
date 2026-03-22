import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

const SYMBOL_CONFIG = {
  NQ: {
    displayName: "Nasdaq Futures",
    yahooSymbol: "NQ=F",
    basePrice: 18250,
    tickSize: 0.25,
    tickValue: 5,
  },
  ES: {
    displayName: "S&P 500 Futures",
    yahooSymbol: "ES=F",
    basePrice: 5285,
    tickSize: 0.25,
    tickValue: 12.5,
  },
  CL: {
    displayName: "Crude Oil Futures",
    yahooSymbol: "CL=F",
    basePrice: 77.2,
    tickSize: 0.01,
    tickValue: 10,
  },
  GC: {
    displayName: "Gold Futures",
    yahooSymbol: "GC=F",
    basePrice: 2337,
    tickSize: 0.1,
    tickValue: 10,
  },
};

const SESSION_RULES = {
  Tokyo: {
    minMovePct: 0.08,
    emaSpreadFactor: 0.00012,
    vwapDistanceFactor: 0.00008,
    preferredSymbols: ["GC", "CL"],
    label: "Tokyo",
  },
  London: {
    minMovePct: 0.12,
    emaSpreadFactor: 0.00018,
    vwapDistanceFactor: 0.00012,
    preferredSymbols: ["GC", "CL", "ES"],
    label: "London",
  },
  "New York": {
    minMovePct: 0.18,
    emaSpreadFactor: 0.00022,
    vwapDistanceFactor: 0.00016,
    preferredSymbols: ["NQ", "ES", "CL", "GC"],
    label: "New York",
  },
};

const brokerState = {
  connected: false,
  mode: "DEMO",
  apiKey: "",
  apiSecret: "",
  accountLabel: "Not Connected",
};

const orders = [];
const positions = [];

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

function vwapFromCandles(candles) {
  let pv = 0;
  let volumeTotal = 0;

  for (const c of candles) {
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);
    const volume = Number(c.volume || 0);
    const typicalPrice = (high + low + close) / 3;
    pv += typicalPrice * volume;
    volumeTotal += volume;
  }

  if (!volumeTotal) return Number(candles[candles.length - 1]?.close || 0);
  return pv / volumeTotal;
}

function getVolatilityLabel(movePctAbs, sessionRule) {
  if (movePctAbs >= sessionRule.minMovePct * 2.2) return "High";
  if (movePctAbs >= sessionRule.minMovePct) return "Normal";
  return "Low";
}

function getSessionRule(sessionName) {
  return SESSION_RULES[sessionName] || SESSION_RULES["New York"];
}

function buildSessionLogic({
  symbol,
  price,
  ema9,
  ema21,
  vwap,
  movePct,
  sessionName,
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

  if (longTrend) bias = "Bullish";
  if (shortTrend) bias = "Bearish";

  if (longTrend && enoughMove && enoughStructure) {
    signal = preferred ? "BUY" : "NO TRADE";
    note =
      signal === "BUY"
        ? `Momentum above VWAP, EMA trend bullish, and ${sessionName} thresholds passed.`
        : `Bullish structure exists, but ${symbol} is not a priority contract for ${sessionName}.`;
  } else if (shortTrend && enoughMove && enoughStructure) {
    signal = preferred ? "SELL" : "NO TRADE";
    note =
      signal === "SELL"
        ? `Momentum below VWAP, EMA trend bearish, and ${sessionName} thresholds passed.`
        : `Bearish structure exists, but ${symbol} is not a priority contract for ${sessionName}.`;
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
    sessionThresholds: {
      minMovePct: sessionRule.minMovePct,
      minEmaSpread: roundTo(minEmaSpread, 4),
      minVwapDistance: roundTo(minVwapDistance, 4),
    },
  };
}

function makeSimData(symbol, sessionName) {
  const config = SYMBOL_CONFIG[symbol];
  const variance = (Math.random() - 0.5) * 20;

  const price =
    symbol === "CL"
      ? roundTo(config.basePrice + variance / 20, 2)
      : roundTo(config.basePrice + variance, 2);

  const ema9 =
    symbol === "CL"
      ? roundTo(price + (Math.random() - 0.5) * 0.3, 2)
      : roundTo(price + (Math.random() - 0.5) * 6, 2);

  const ema21 =
    symbol === "CL"
      ? roundTo(price + (Math.random() - 0.5) * 0.5, 2)
      : roundTo(price + (Math.random() - 0.5) * 10, 2);

  const vwap =
    symbol === "CL"
      ? roundTo(price + (Math.random() - 0.5) * 0.25, 2)
      : roundTo(price + (Math.random() - 0.5) * 5, 2);

  const prevClose =
    symbol === "CL"
      ? roundTo(price + (Math.random() - 0.5) * 0.8, 2)
      : roundTo(price + (Math.random() - 0.5) * 18, 2);

  const movePct = roundTo(((price - prevClose) / prevClose) * 100, 2);

  const sessionLogic = buildSessionLogic({
    symbol,
    price,
    ema9,
    ema21,
    vwap,
    movePct,
    sessionName,
  });

  return {
    symbol,
    displayName: config.displayName,
    price,
    ema9,
    ema21,
    vwap,
    prevClose,
    movePct,
    session: sessionName,
    signal: sessionLogic.signal,
    bias: sessionLogic.bias,
    note: sessionLogic.note,
    volatility: sessionLogic.volatility,
    preferred: sessionLogic.preferred,
    sessionThresholds: sessionLogic.sessionThresholds,
    sessionHigh: roundTo(Math.max(price, ema9, ema21, vwap), 2),
    sessionLow: roundTo(Math.min(price, ema9, ema21, vwap), 2),
    tickSize: config.tickSize,
    tickValue: config.tickValue,
    provider: "server-sim",
    timestamp: new Date().toISOString(),
  };
}

async function fetchYahooMarketData(symbol, sessionName) {
  const config = SYMBOL_CONFIG[symbol];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    config.yahooSymbol
  )}?interval=5m&range=1d`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];

  if (!result || !quote) throw new Error("Yahoo malformed response");

  const closes = (quote.close || []).filter((x) => typeof x === "number");
  const highs = quote.high || [];
  const lows = quote.low || [];
  const volumes = quote.volume || [];

  if (!closes.length) throw new Error("No close data");

  const candles = closes.map((close, i) => ({
    close,
    high: typeof highs[i] === "number" ? highs[i] : close,
    low: typeof lows[i] === "number" ? lows[i] : close,
    volume: typeof volumes[i] === "number" ? volumes[i] : 0,
  }));

  const price = closes[closes.length - 1];
  const ema9Value = ema(closes.slice(-20), 9);
  const ema21Value = ema(closes.slice(-30), 21);
  const vwapValue = vwapFromCandles(candles.slice(-30));
  const prevClose =
    typeof result?.meta?.previousClose === "number"
      ? result.meta.previousClose
      : closes[0];

  const movePct = roundTo(((price - prevClose) / prevClose) * 100, 2);
  const sessionHigh = roundTo(Math.max(...closes.slice(-30)), 2);
  const sessionLow = roundTo(Math.min(...closes.slice(-30)), 2);

  const sessionLogic = buildSessionLogic({
    symbol,
    price,
    ema9: ema9Value,
    ema21: ema21Value,
    vwap: vwapValue,
    movePct,
    sessionName,
  });

  return {
    symbol,
    displayName: config.displayName,
    price: roundTo(price, 2),
    ema9: roundTo(ema9Value, 2),
    ema21: roundTo(ema21Value, 2),
    vwap: roundTo(vwapValue, 2),
    prevClose: roundTo(prevClose, 2),
    movePct,
    session: sessionName,
    signal: sessionLogic.signal,
    bias: sessionLogic.bias,
    note: sessionLogic.note,
    volatility: sessionLogic.volatility,
    preferred: sessionLogic.preferred,
    sessionThresholds: sessionLogic.sessionThresholds,
    sessionHigh,
    sessionLow,
    tickSize: config.tickSize,
    tickValue: config.tickValue,
    provider: "yahoo-chart",
    timestamp: new Date().toISOString(),
  };
}

async function getMarketData(symbol, sessionName) {
  if (!SYMBOL_CONFIG[symbol]) return null;

  try {
    return await fetchYahooMarketData(symbol, sessionName);
  } catch {
    return makeSimData(symbol, sessionName);
  }
}

app.get("/", (_req, res) => {
  res.send("Dy Trader API is running");
});

app.get("/api/futures", async (req, res) => {
  const symbol = String(req.query.symbol || "NQ").toUpperCase();
  const session = String(req.query.session || "New York");
  const data = await getMarketData(symbol, session);

  if (!data) {
    return res.status(400).json({
      error: "Unsupported symbol",
      supported: Object.keys(SYMBOL_CONFIG),
    });
  }

  res.json(data);
});

app.get("/api/scanner", async (req, res) => {
  const session = String(req.query.session || "New York");
  const results = await Promise.all(
    Object.keys(SYMBOL_CONFIG).map((symbol) => getMarketData(symbol, session))
  );
  res.json(results.filter(Boolean));
});

app.get("/api/orders", (_req, res) => {
  res.json(orders);
});

app.post("/api/orders", async (req, res) => {
  const {
    symbol,
    side,
    qty,
    orderType,
    limitPrice,
    stopLoss,
    takeProfit,
    session,
  } = req.body || {};

  if (!SYMBOL_CONFIG[symbol]) {
    return res.status(400).json({ error: "Unsupported symbol" });
  }

  const market = await getMarketData(symbol, session || "New York");
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

  res.json({ ok: true, order });
});

app.get("/api/positions", async (_req, res) => {
  const updated = await Promise.all(
    positions.map(async (p) => {
      const market = await getMarketData(p.symbol, p.session || "New York");
      const currentPrice = Number(market?.price ?? p.currentPrice);
      const multiplier = p.side === "BUY" ? 1 : -1;
      const pnl = roundTo((currentPrice - p.entryPrice) * p.qty * multiplier, 2);

      return {
        ...p,
        currentPrice,
        pnl,
      };
    })
  );

  positions.length = 0;
  positions.push(...updated);
  res.json(updated);
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
