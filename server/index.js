import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.send("Dy Trader API is running");
});

app.get("/api/futures", (req, res) => {
  res.json({
    symbol: "ES",
    price: 5200,
    ema: 5195,
    vwap: 5198,
    signal: "BUY"
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
