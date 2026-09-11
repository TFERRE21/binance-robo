const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/api/status", (req, res) => {
  res.json({
    status: "online",
    sistema: "Binance-Robo",
    painel: "backend funcionando"
  });
});

app.get("/", (req, res) => {
  res.send("Binance-Robo Panel API online");
});

app.listen(PORT, () => {
  console.log(`Painel backend rodando na porta ${PORT}`);
});
