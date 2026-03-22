import express from "express";
import yahooFinance from "yahoo-finance2";

const app = express();

const SYMBOL_MAP = {
  ES: "ES=F",
  NQ: "NQ=F",
  YM: "YM=F",
  RTY: "RTY=F",
  CL: "CL=F",
  GC: "GC=F"
};

// EMA
function calculateEMA(data, period) {
  let k = 2 / (period + 1);
  let ema = data[0];
  let result = [];

  for (let price of data) {
    ema = price * k + ema * (1 - k);
    result.push(ema);
  }

  return result;
}

// VWAP
function calculateVWAP(candles) {
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  let result = [];

  for (let c of candles) {
    let typical = (c.high + c.low + c.close) / 3;
    cumulativePV += typical * c.volume;
    cumulativeVolume += c.volume;
    result.push(cumulativePV / cumulativeVolume);
  }

  return result;
}

// Session detection
function getSession() {
  const now = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York"
  });
  const hour = new Date(now).getHours();

  if (hour >= 19 || hour < 4) return "TOKYO";
  if (hour >= 3 && hour < 12) return "LONDON";
  if (hour >= 9 && hour < 16) return "NEW_YORK";
  return "OFF_HOURS";
}

app.get("/", (req, res) => {
  res.send("Dy Trader API running");
});

app.get("/api/futures", async (req, res) => {
  try {
    const symbol = req.query.symbol || "ES";
    const yahooSymbol = SYMBOL_MAP[symbol];

    const result = await yahooFinance.chart(yahooSymbol, {
      interval: "1m",
      range: "1d"
    });

    const candles = result.quotes.map(q => ({
      close: q.close,
      high: q.high,
      low: q.low,
      volume: q.volume
    }));

    const closes = candles.map(c => c.close);

    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const vwap = calculateVWAP(candles);

    const latestPrice = closes.at(-1);
    const latestEMA9 = ema9.at(-1);
    const latestEMA21 = ema21.at(-1);
    const latestVWAP = vwap.at(-1);

    let signal = "NONE";

    if (
      latestPrice > latestVWAP &&
      latestEMA9 > latestEMA21
    ) {
      signal = "BUY";
    } else if (
      latestPrice < latestVWAP &&
      latestEMA9 < latestEMA21
    ) {
      signal = "SELL";
    }

    res.json({
      symbol,
      price: latestPrice,
      ema9: latestEMA9,
      ema21: latestEMA21,
      vwap: latestVWAP,
      session: getSession(),
      signal
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
