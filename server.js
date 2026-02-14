const express = require("express");
const fs = require("fs");
const path = require("path");

// 🔥 Inicia o robô automaticamente
require("./robo");

const app = express();
const PORT = process.env.PORT || 3000;

// 📁 Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, "public")));

// ✅ Rota principal (resolve erro Not Found no Render)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 📊 API STATUS (usado pelo painel)
app.get("/api/status", (req, res) => {
  try {
    const data = fs.readFileSync("status.json", "utf8");
    res.json(JSON.parse(data));
  } catch (error) {
    res.json({
      status: "Inicializando...",
      saldo: 0,
      lucro: 0,
      perda: 0,
      total: 0
    });
  }
});

// 📈 API TRADES (histórico)
app.get("/api/trades", (req, res) => {
  try {
    const data = fs.readFileSync("trades.json", "utf8");
    res.json(JSON.parse(data));
  } catch (error) {
    res.json([]);
  }
});

// 🚀 Inicia servidor
app.listen(PORT, () => {
  console.log("=====================================");
  console.log("🚀 Painel rodando na porta:", PORT);
  console.log("🌐 Ambiente:", process.env.NODE_ENV || "produção");
  console.log("=====================================");
});