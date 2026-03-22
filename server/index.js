import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

// Test route
app.get("/", (req, res) => {
  res.send("Dy Trader API is running");
});

// 🔥 THIS IS THE IMPORTANT ROUTE
app.get("/api/futures", (req, res) => {
  res.json({
    symbol: "NASDAQ",
    price: 18250,
    ema: 18230,
    vwap: 18210,
    signal: "BUY"
  });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
