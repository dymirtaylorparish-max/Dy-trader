import express from "express";
import cors from "cors";
import yahooFinance from "yahoo-finance2";

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

    const quote = await yahooFinance.quote(yahooSymbol);

    const price = Number(quote?.regularMarketPrice || 0);
    const prevClose = Number(quote?.regularMarketPreviousClose || price);
    const signal =
      price > prevClose ? "BUY" : price < prevClose ? "SELL" : "NONE";

    res.json({
      symbol,
      price,
      ema: price,
      vwap: price,
      signal,
      provider: "yahoo-quote"
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch live data",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
