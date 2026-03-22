import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY;

const SYMBOL_MAP = {
  NQ: { twelve: "NQ", yahoo: "NQ=F" },
  ES: { twelve: "ES", yahoo: "ES=F" },
  CL: { twelve: "CL", yahoo: "CL=F" },
  GC: { twelve: "GC", yahoo: "GC=F" },
  BTC: { twelve: "BTC/USD", yahoo: "BTC-USD" }
};

app.get("/", (_req, res) => {
  res.send("Dy Trader API is running");
});

async function fetchFromTwelve(symbol) {
  const mapped = SYMBOL_MAP[symbol]?.twelve;
  if (!mapped) throw new Error("Unsupported symbol");

  if (!TWELVE_KEY) throw new Error("Missing TWELVE_DATA_API_KEY");

  const url =
    `https://api.twelvedata.com/price?symbol=${encodeURIComponent(mapped)}&apikey=${TWELVE_KEY}`;

  const res = await fetch(url);
  const json = await res.json();

  if (!res.ok || json.status === "error" || !json.price) {
    throw new Error(json.message || "Twelve Data failed");
  }

  const price = Number(json.price);

  return {
    symbol,
    price,
    ema: price,
    vwap: price,
    signal: "NONE",
    provider: "twelvedata"
  };
}

async function fetchFromYahoo(symbol) {
  const mapped = SYMBOL_MAP[symbol]?.yahoo;
  if (!mapped) throw new Error("Unsupported symbol");

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mapped)}?interval=1m&range=1d`;

  const response = await fetch(url);
  const json = await response.json();

  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];

  if (!result || !meta || !quote) {
    throw new Error("Yahoo failed");
  }

  const closes = (quote.close || []).filter((v) => typeof v === "number");
  const latestClose =
    closes.length > 0 ? closes[closes.length - 1] : meta.regularMarketPrice || 0;

  const prevClose = Number(meta.previousClose || latestClose);
  const price = Number(latestClose || 0);

  const signal =
    price > prevClose ? "BUY" :
    price < prevClose ? "SELL" :
    "NONE";

  return {
    symbol,
    price,
    ema: price,
    vwap: price,
    signal,
    provider: "yahoo"
  };
}

app.get("/api/futures", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "NQ").toUpperCase();

    try {
      const data = await fetchFromTwelve(symbol);
      return res.json(data);
    } catch (twelveError) {
      const data = await fetchFromYahoo(symbol);
      return res.json({
        ...data,
        fallbackReason: twelveError.message
      });
    }
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
