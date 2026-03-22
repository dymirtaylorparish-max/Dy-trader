import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

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

app.get("/api/futures", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "NQ").toUpperCase();

    const map = {
      NQ: "NQ=F",
      ES: "ES=F",
      CL: "CL=F",
      GC: "GC=F",
      BTC: "BTC-USD"
    };

    const yahooSymbol = map[symbol];
    if (!yahooSymbol) {
      return res.status(400).json({ error: "Unsupported symbol" });
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      yahooSymbol
    )}?interval=1m&range=1d`;

    const response = await fetch(url);
    const json = await response.json();

    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    const quote = result?.indicators?.quote?.[0];

    if (!result || !meta || !quote) {
      return res.status(500).json({
        error: "Failed to fetch live data",
        details: "Invalid Yahoo response"
      });
    }

    const closes = (quote.close || []).filter((v) => typeof v === "number");
    const highs = (quote.high || []).filter((v) => typeof v === "number");
    const lows = (quote.low || []).filter((v) => typeof v === "number");
    const volumes = (quote.volume || []).map((v) => (typeof v === "number" ? v : 1));

    const latestPrice =
      closes.length > 0 ? Number(closes[closes.length - 1].toFixed(2)) : Number(meta.regularMarketPrice || 0);

    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const vwap = calcVWAP(highs, lows, closes, volumes);
    const signal = buildSignal(latestPrice, ema9, ema21, vwap);

    return res.json({
      symbol,
      price: latestPrice,
      ema: ema9,
      ema9,
      ema21,
      vwap,
      signal,
      provider: "yahoo-chart-api"
    });
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
