const express = require("express");
const app = express();

const PORT = process.env.PORT || 8080;

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.json({ message: "Payment Gateway Proxy running" });
});

app.listen(PORT, () => {
  console.log(`Payment Gateway Proxy listening on port ${PORT}`);
});
