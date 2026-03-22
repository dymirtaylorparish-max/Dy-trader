import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

app.get("/", (_req, res) => {
  res.send("Dy Trader API is running");
});

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
    const latestClose =
      closes.length > 0 ? closes[closes.length - 1] : meta.regularMarketPrice || 0;

    const prevClose = Number(meta.previousClose || latestClose);
    const price = Number(latestClose || 0);

    const signal =
      price > prevClose ? "BUY" :
      price < prevClose ? "SELL" :
      "NONE";

    return res.json({
      symbol,
      price,
      ema: price,
      vwap: price,
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
