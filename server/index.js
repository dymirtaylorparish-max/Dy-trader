import express from "express";
import yahooFinance from "yahoo-finance2";

const app = express();

app.get("/", (req, res) => {
  res.send("Dy Trader API is running");
});

app.get("/api/test", async (req, res) => {
  try {
    const data = await yahooFinance.quote("ES=F");
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
