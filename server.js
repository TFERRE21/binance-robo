require('dotenv').config();
const express = require('express');
const path = require('path');
const Binance = require('binance-api-node').default;

const app = express();
const PORT = process.env.PORT || 3000;

// =============================
// SERVIR PASTA PUBLIC
// =============================
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Status da API
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    robo: 'EMA 9/21 + RSI',
    ambiente: process.env.NODE_ENV || 'development'
  });
});

// =============================
// INICIANDO BINANCE
// =============================
const client = Binance({
  apiKey: process.env.API_KEY || '',
  apiSecret: process.env.API_SECRET || ''
});

console.log("🚀 ROBÔ EMA 9/21 + RSI INICIADO");

// =============================
// START SERVER
// =============================
app.listen(PORT, () => {
  console.log("=================================");
  console.log(`📊 Painel rodando na porta: ${PORT}`);
  console.log(`🌎 Ambiente: ${process.env.NODE_ENV}`);
  console.log("=================================");
});