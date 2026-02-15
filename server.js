require("dotenv").config();
const Binance = require("binance-api-node").default;
const express = require("express");

const app = express();

const client = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  recvWindow: 60000
});

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */

const INTERVALO = "5m";
const SCAN_INTERVAL = 120000; // 2 minutos
const MAX_MOEDAS = 35;

const USAR_PERCENTUAL_SALDO = true;
const PERCENTUAL_ENTRADA = 0.90;
const INVESTIMENTO_FIXO = 19;

const TAKE_PROFIT = 0.05; // 5%
const STOP_LOSS = 0.03;   // 3%

let operando = false;

/* ================= AUXILIARES ================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calcularEMA(values, period) {
  const k = 2 / (period + 1);
  let ema = [values[0]];

  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }

  return ema;
}

function calcularRSI(values, period = 14) {
  let ganhos = 0;
  let perdas = 0;

  for (let i = values.length - period; i < values.length - 1; i++) {
    const diferenca = values[i + 1] - values[i];
    if (diferenca >= 0) ganhos += diferenca;
    else perdas -= diferenca;
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

    console.log(`🟢 COMPRANDO ${symbol} - $${valorCompra}`);

    const ordem = await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    const precoEntrada = parseFloat(ordem.fills[0].price);

    const precoTP = (precoEntrada * (1 + TAKE_PROFIT)).toFixed(5);
    const precoSL = (precoEntrada * (1 - STOP_LOSS)).toFixed(5);
    const precoSLTrigger = (precoEntrada * (1 - STOP_LOSS * 0.9)).toFixed(5);

    console.log(`🎯 TP: ${precoTP}`);
    console.log(`🛑 SL: ${precoSL}`);

    await client.orderOco({
      symbol,
      side: "SELL",
      quantity: quantidade,
      price: precoTP,
      stopPrice: precoSLTrigger,
      stopLimitPrice: precoSL,
      stopLimitTimeInForce: "GTC"
    });

    console.log("✅ OCO enviado (TP + SL)");

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

      const pares = exchangeInfo.symbols
        .filter(s => s.status === "TRADING" && s.quoteAsset === "USDT")
        .slice(0, MAX_MOEDAS);

      for (const par of pares) {

        const candles = await client.candles({
          symbol: par.symbol,
          interval: INTERVALO,
          limit: 100
        });

        const closes = candles.map(c => parseFloat(c.close));

        const ema9 = calcularEMA(closes, 9).pop();
        const ema21 = calcularEMA(closes, 21).pop();
        const rsi = calcularRSI(closes, 14);

        console.log(
          `${par.symbol} | EMA9: ${ema9.toFixed(4)} EMA21: ${ema21.toFixed(4)} RSI: ${rsi.toFixed(2)}`
        );

        const entrada =
          ema9 > ema21 &&
          rsi < 40;

        if (entrada) {
          console.log(`🚀 SINAL DE COMPRA EM ${par.symbol}`);
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
  console.log("🔥 ROBÔ EMA 9/21 + RSI + OCO INICIADO");
  console.log("🌐 Rodando na porta:", PORT);
  iniciarRobo();
});