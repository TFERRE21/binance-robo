require("dotenv").config();
const Binance = require("binance-api-node").default;
const express = require("express");

const app = express();

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  recvWindow: 60000
});

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */

const INTERVALO = "5m";
const SCAN_INTERVAL = 90000; // 1m30s
const MAX_MOEDAS = 40;

const USAR_PERCENTUAL_SALDO = true;
const PERCENTUAL_ENTRADA = 0.90;
const INVESTIMENTO_FIXO = 19;

const TAKE_PROFIT = 0.05; // 5%
const STOP_LOSS = 0.025;  // 2.5%

let operando = false;

/* ================= EXCLUSÕES ================= */

const TOP10_EXCLUIR = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
  "ADAUSDT","DOGEUSDT","AVAXUSDT","DOTUSDT","TRXUSDT"
];

const STABLES = ["USDC","BUSD","FDUSD","TUSD","DAI"];

/* ================= AUX ================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calcularEMA(values, period) {
  const k = 2 / (period + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }

  return ema;
}

function calcularRSI(values, period = 14) {
  let ganhos = 0;
  let perdas = 0;

  for (let i = values.length - period; i < values.length - 1; i++) {
    const diff = values[i + 1] - values[i];
    if (diff >= 0) ganhos += diff;
    else perdas -= diff;
  }

  if (perdas === 0) return 100;
  const rs = ganhos / perdas;
  return 100 - (100 / (1 + rs));
}

/* ================= COMPRA ================= */

async function executarCompra(symbol) {
  try {
    if (operando) return;
    operando = true;

    const accountInfo = await client.accountInfo();
    const saldoUSDT = parseFloat(
      accountInfo.balances.find(b => b.asset === "USDT").free
    );

    const valorCompra = USAR_PERCENTUAL_SALDO
      ? saldoUSDT * PERCENTUAL_ENTRADA
      : INVESTIMENTO_FIXO;

    if (valorCompra < 10) {
      console.log("Saldo insuficiente.");
      operando = false;
      return;
    }

    const precoAtual = parseFloat(
      (await client.prices({ symbol }))[symbol]
    );

    const quantidade = (valorCompra / precoAtual).toFixed(5);

    console.log(`🟢 COMPRANDO ${symbol} - $${valorCompra.toFixed(2)}`);

    const ordem = await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    const precoEntrada = parseFloat(ordem.fills[0].price);

    const precoTP = (precoEntrada * (1 + TAKE_PROFIT)).toFixed(5);
    const precoSL = (precoEntrada * (1 - STOP_LOSS)).toFixed(5);
    const precoSLTrigger = (precoEntrada * (1 - STOP_LOSS * 0.98)).toFixed(5);

    await client.orderOco({
      symbol,
      side: "SELL",
      quantity: quantidade,
      price: precoTP,
      stopPrice: precoSLTrigger,
      stopLimitPrice: precoSL,
      stopLimitTimeInForce: "GTC"
    });

    console.log("✅ OCO enviado com sucesso");

  } catch (err) {
    console.log("Erro na compra:", err.message);
  } finally {
    operando = false;
  }
}

/* ================= ROBÔ ================= */

async function iniciarRobo() {

  while (true) {

    try {

      console.log("🔎 Escaneando mercado...");

      const exchangeInfo = await client.exchangeInfo();

      let pares = exchangeInfo.symbols
        .filter(s =>
          s.status === "TRADING" &&
          s.quoteAsset === "USDT" &&
          !TOP10_EXCLUIR.includes(s.symbol) &&
          !STABLES.some(st => s.baseAsset.includes(st))
        )
        .slice(0, MAX_MOEDAS);

      console.log(`📊 Analisando ${pares.length} moedas`);

      for (const par of pares) {

        if (operando) break;

        const candles = await client.candles({
          symbol: par.symbol,
          interval: INTERVALO,
          limit: 100
        });

        const closes = candles.map(c => parseFloat(c.close));
        const volumes = candles.map(c => parseFloat(c.volume));

        const ema9 = calcularEMA(closes.slice(-9), 9);
        const ema21 = calcularEMA(closes.slice(-21), 21);
        const rsi = calcularRSI(closes, 14);

        const precoAtual = closes[closes.length - 1];

        const volumeAtual = volumes[volumes.length - 1];
        const volumeMedio =
          volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

        console.log(
          `${par.symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`
        );

        const entrada =
          ema9 > ema21 &&
          rsi > 45 &&
          rsi < 60 &&
          precoAtual > ema9 &&
          volumeAtual > volumeMedio;

        if (entrada) {
          console.log(`🚀 SINAL DETECTADO EM ${par.symbol}`);
          await executarCompra(par.symbol);
          break;
        }
      }

    } catch (err) {
      console.log("Erro geral:", err.message);
    }

    await sleep(SCAN_INTERVAL);
  }
}

/* ================= SERVIDOR ================= */

app.get("/", (req, res) => {
  res.send("🚀 ROBÔ BINANCE ONLINE");
});

app.listen(PORT, () => {
  console.log("🔥 ROBÔ EMA 9/21 + RSI + VOLUME + OCO INICIADO");
  console.log("🌐 Rodando na porta:", PORT);
  iniciarRobo();
});