import express from "express";
import cors from "cors";
import yahooFinance from "yahoo-finance2";

const app = express();
app.use(cors());

const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY;

const SYMBOL_MAP = {
  NQ: { twelve: "NQ", yahoo: "NQ=F" },
  ES: { twelve: "ES", yahoo: "ES=F" },
  CL: { twelve: "CL", yahoo: "CL=F" },
  GC: { twelve: "GC", yahoo: "GC=F" },
  SI: { twelve: "SI", yahoo: "SI=F" },
  NG: { twelve: "NG", yahoo: "NG=F" },
  BTC: { twelve: "BTC/USD", yahoo: "BTC-USD" },
};

function calcEMA(values, period) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return Number(ema.toFixed(2));
}

function calcVWAP(candles) {
  let cumulativePV = 0;
  let cumulativeVolume = 0;

  for (const c of candles) {
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);
    const volume = Number(c.volume || 1);
    const typicalPrice = (high + low + close) / 3;

    cumulativePV += typicalPrice * volume;
    cumulativeVolume += volume;
  }

  if (!cumulativeVolume) {
    return Number(candles[candles.length - 1].close);
  }

  return Number((cumulativePV / cumulativeVolume).toFixed(2));
}

function buildSignal(price, emaFast, emaSlow, vwap) {
  if (price > vwap && emaFast > emaSlow) return "BUY";
  if (price < vwap && emaFast < emaSlow) return "SELL";
  return "NONE";
}

async function fetchFromTwelve(symbol) {
  if (!TWELVE_KEY) throw new Error("Missing TWELVE_DATA_API_KEY");

  const mapped = SYMBOL_MAP[symbol]?.twelve;
  if (!mapped) throw new Error(`Unsupported symbol: ${symbol}`);

  const url =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${encodeURIComponent(mapped)}` +
    `&interval=1min&outputsize=50&apikey=${TWELVE_KEY}`;

  const res = await fetch(url);
  const json = await res.json();

  if (!res.ok || json.status === "error" || !Array.isArray(json.values)) {
    throw new Error(json.message || "Twelve Data failed");
  }

  const candles = json.values
    .map((c) => ({
      datetime: c.datetime,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 1),
    }))
    .reverse();

  return candles;
}

async function fetchFromYahoo(symbol) {
  const mapped = SYMBOL_MAP[symbol]?.yahoo;
  if (!mapped) throw new Error(`Unsupported symbol: ${symbol}`);

  const result = await yahooFinance.chart(mapped, {
    interval: "1m",
    range: "1d",
  });

  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
  if (!quotes.length) throw new Error("Yahoo Finance failed");

  return quotes
    .filter((q) => q.close != null && q.high != null && q.low != null)
    .map((q) => ({
      datetime: q.date,
      open: Number(q.open ?? q.close),
      high: Number(q.high),
      low: Number(q.low),
      close: Number(q.close),
      volume: Number(q.volume || 1),
    }));
}

async function getLiveData(symbol) {
  try {
    const candles = await fetchFromTwelve(symbol);
    return { provider: "twelvedata", candles };
  } catch (twelveError) {
    const candles = await fetchFromYahoo(symbol);
    return { provider: "yahoo", candles, fallbackReason: twelveError.message };
  }
}

app.get("/", (_req, res) => {
  res.send("Dy Trader API is running");
});

app.get("/api/futures", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "NQ").toUpperCase();

    if (!SYMBOL_MAP[symbol]) {
      return res.status(400).json({
        error: "Unsupported symbol",
        supported: Object.keys(SYMBOL_MAP),
      });
    }

    const { provider, candles, fallbackReason } = await getLiveData(symbol);

    const closes = candles.map((c) => Number(c.close));
    const price = Number(closes[closes.length - 1].toFixed(2));
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const vwap = calcVWAP(candles);
    const signal = buildSignal(price, ema9, ema21, vwap);

    res.json({
      symbol,
      provider,
      price,
      ema: ema9,
      ema9,
      ema21,
      vwap,
      signal,
      candles: candles.slice(-20),
      fallbackReason: fallbackReason || null,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch live data",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
