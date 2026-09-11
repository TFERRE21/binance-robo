const express = require("express");
const Binance = require("binance-api-node").default;

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

/* =========================================================
   CONEXÃO COM A BINANCE
   SOMENTE CONSULTAS — NENHUMA COMPRA OU VENDA
========================================================= */

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET
});

/* =========================================================
   STATUS DO PAINEL
========================================================= */

app.get("/api/status", (req, res) => {
  res.json({
    status: "online",
    sistema: "Binance-Robo",
    painel: "backend funcionando"
  });
});

/* =========================================================
   CONSULTAR CONTA BINANCE
   SOMENTE LEITURA
========================================================= */

app.get("/api/account", async (req, res) => {

  try {

    const account = await client.accountInfo();

    const saldos = account.balances
      .filter(balance => Number(balance.free) > 0 || Number(balance.locked) > 0)
      .map(balance => ({
        asset: balance.asset,
        free: Number(balance.free),
        locked: Number(balance.locked)
      }));

    const usdt = saldos.find(
      balance => balance.asset === "USDT"
    );

    res.json({
      status: "ok",
      usdt: usdt || {
        asset: "USDT",
        free: 0,
        locked: 0
      },
      saldos
    });

  } catch (error) {

    console.error("Erro ao consultar Binance:", error.message);

    res.status(500).json({
      status: "error",
      mensagem: "Não foi possível consultar a conta Binance."
    });

  }

});

/* =========================================================
   PÁGINA INICIAL
========================================================= */

app.get("/", (req, res) => {
  res.send("Binance-Robo Panel API online");
});

/* =========================================================
   SERVIDOR
========================================================= */

app.listen(PORT, () => {
  console.log(`Painel backend rodando na porta ${PORT}`);
});
