import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;

app.get("/", (_req, res) => {
  res.send("Dy Trader API is running");
});

function calcEMA(values, period) {
  if (!values.length) return 0;

  const k = 2 / (period + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }

  return Number(ema.toFixed(2));
}

function calcVWAP(highs, lows, closes, volumes) {
  if (!closes.length) return 0;

  let cumulativePV = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < closes.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    const volume = volumes[i] || 1;

    cumulativePV += typicalPrice * volume;
    cumulativeVolume += volume;
  }

  if (!cumulativeVolume) return Number(closes[closes.length - 1] || 0);

  return Number((cumulativePV / cumulativeVolume).toFixed(2));
}

function buildSignal(price, ema9, ema21, vwap) {
  if (price > ema9 && ema9 > ema21 && price > vwap) return "BUY";
  if (price < ema9 && ema9 < ema21 && price < vwap) return "SELL";
  return "NONE";
}

async function fetchFromTwelve(symbol) {
  if (!TWELVE_DATA_API_KEY) {
    throw new Error("Missing TWELVE_DATA_API_KEY");
  }

const map = {
  NQ: "NASDAQ100",
  ES: "SPX",
  CL: "WTI",
  GC: "XAU/USD",
  BTC: "BTC/USD"
};

  const twelveSymbol = map[symbol];
  if (!twelveSymbol) {
    throw new Error("Unsupported Twelve Data symbol");
  }

  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    twelveSymbol
  )}&interval=1min&outputsize=100&apikey=${TWELVE_DATA_API_KEY}`;

  const response = await fetch(url);
  const json = await response.json();

  if (json.status === "error") {
    throw new Error(json.message || "Twelve Data error");
  }

  if (!json.values || !Array.isArray(json.values) || !json.values.length) {
    throw new Error("No valid candles returned");
  }

  const candles = json.values.reverse();

  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];

  for (const candle of candles) {
    const c = Number(candle.close);
    const h = Number(candle.high);
    const l = Number(candle.low);
    const v = Number(candle.volume || 1);

    if (!Number.isNaN(c) && !Number.isNaN(h) && !Number.isNaN(l)) {
      closes.push(c);
      highs.push(h);
      lows.push(l);
      volumes.push(!Number.isNaN(v) ? v : 1);
    }
  }

  if (!closes.length) {
    throw new Error("No valid candles returned");
  }

  const price = Number(closes[closes.length - 1].toFixed(2));
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const vwap = calcVWAP(highs, lows, closes, volumes);
  const signal = buildSignal(price, ema9, ema21, vwap);

  return {
    symbol,
    price,
    ema: ema9,
    ema9,
    ema21,
    vwap,
    signal,
    provider: "twelvedata"
  };
}

async function fetchBTCFromYahoo() {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1m&range=1d";

  const response = await fetch(url);
  const json = await response.json();

  const result = json?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];

  if (!result || !quote) {
    throw new Error("Invalid Yahoo response");
  }

  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];

  for (let i = 0; i < (quote.close?.length || 0); i++) {
    const c = quote.close[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const v = quote.volume?.[i];

    if (
      typeof c === "number" &&
      typeof h === "number" &&
      typeof l === "number"
    ) {
      closes.push(c);
      highs.push(h);
      lows.push(l);
      volumes.push(typeof v === "number" ? v : 1);
    }
  }

  if (!closes.length) {
    throw new Error("No valid candles returned");
  }

  const price = Number(closes[closes.length - 1].toFixed(2));
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const vwap = calcVWAP(highs, lows, closes, volumes);
  const signal = buildSignal(price, ema9, ema21, vwap);

  return {
    symbol: "BTC",
    price,
    ema: ema9,
    ema9,
    ema21,
    vwap,
    signal,
    provider: "yahoo-chart-api"
  };
}

app.get("/api/futures", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "NQ").toUpperCase();

    if (symbol === "BTC") {
      const data = await fetchBTCFromYahoo();
      return res.json(data);
    }

    const data = await fetchFromTwelve(symbol);
    return res.json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch live data",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
