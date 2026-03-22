import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

const SYMBOL_CONFIG = {
  NQ: {
    displayName: "Nasdaq Futures",
    basePrice: 18250,
    tickSize: 0.25,
    tickValue: 5,
    provider: "server-sim",
  },
  ES: {
    displayName: "S&P 500 Futures",
    basePrice: 5285,
    tickSize: 0.25,
    tickValue: 12.5,
    provider: "server-sim",
  },
  CL: {
    displayName: "Crude Oil Futures",
    basePrice: 77.2,
    tickSize: 0.01,
    tickValue: 10,
    provider: "server-sim",
  },
  GC: {
    displayName: "Gold Futures",
    basePrice: 2337,
    tickSize: 0.1,
    tickValue: 10,
    provider: "server-sim",
  },
};

function roundTo(value, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function makeMarketData(symbol) {
  const config = SYMBOL_CONFIG[symbol];
  if (!config) return null;

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

  let signal = "NO TRADE";
  if (ema9 > ema21 && price > vwap) signal = "BUY";
  if (ema9 < ema21 && price < vwap) signal = "SELL";

  return {
    symbol,
    displayName: config.displayName,
    price,
    ema9,
    ema21,
    vwap,
    prevClose,
    movePct,
    signal,
    tickSize: config.tickSize,
    tickValue: config.tickValue,
    provider: config.provider,
    timestamp: new Date().toISOString(),
  };
}

app.get("/", (_req, res) => {
  res.send("Dy Trader API is running");
});

app.get("/api/futures", (req, res) => {
  const symbol = String(req.query.symbol || "NQ").toUpperCase();
  const data = makeMarketData(symbol);

  if (!data) {
    return res.status(400).json({
      error: "Unsupported symbol",
      supported: Object.keys(SYMBOL_CONFIG),
    });
  }

  res.json(data);
});

app.get("/api/scanner", (_req, res) => {
  const results = Object.keys(SYMBOL_CONFIG).map((symbol) => makeMarketData(symbol));
  res.json(results);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
