require("dotenv").config();
const Binance = require("binance-api-node").default;
const express = require("express");

const app = express();

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
});

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("ROBO BINANCE ONLINE 🚀");
});

app.listen(PORT, () => {
  console.log("🔥 ROBÔ EMA 9/21 + RSI + OCO INICIADO");
  console.log("📊 Painel rodando na porta", PORT);
});

/* ================= CONFIG ================= */

const INTERVALO = "5m";
const TP_PERCENT = 0.05;   // 5% LUCRO
const SL_PERCENT = 0.02;   // 2% STOP
const SCAN_INTERVAL = 120000;
const MAX_MOEDAS = 35;

let operando = false;

/* ================= INDICADORES ================= */

function calcularEMA(periodo, closes) {
  const k = 2 / (periodo + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcularRSI(periodo, closes) {
  let ganhos = 0;
  let perdas = 0;

  for (let i = closes.length - periodo; i < closes.length - 1; i++) {
    const diff = closes[i + 1] - closes[i];
    if (diff >= 0) ganhos += diff;
    else perdas -= diff;
  }

  const rs = ganhos / (perdas || 1);
  return 100 - 100 / (1 + rs);
}

/* ================= AJUSTE STEP SIZE ================= */

function ajustarStepSize(qtd, stepSize) {
  const precision = stepSize.indexOf("1") - 1;
  return parseFloat(qtd.toFixed(precision));
}

/* ================= COMPRA 90% ================= */

async function executarCompra(symbol) {
  try {
    const conta = await client.accountInfo();
    const usdt = conta.balances.find(b => b.asset === "USDT");
    const saldo = parseFloat(usdt.free);

    if (saldo < 10) {
      console.log("❌ Saldo insuficiente");
      return;
    }

    const usar = saldo * 0.9;
    const precoAtual = parseFloat((await client.prices())[symbol]);

    const info = await client.exchangeInfo();
    const par = info.symbols.find(s => s.symbol === symbol);
    const stepSize = par.filters.find(f => f.filterType === "LOT_SIZE").stepSize;

    let quantidade = usar / precoAtual;
    quantidade = ajustarStepSize(quantidade, stepSize);

    console.log(`🚀 Comprando ${symbol} com 90% saldo (${usar.toFixed(2)} USDT)`);

    await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    await executarOCO(symbol, quantidade, precoAtual);

    operando = true;

  } catch (err) {
    console.log("Erro na compra:", err.message);
  }
}

/* ================= OCO 5% ================= */

async function executarOCO(symbol, quantidade, precoCompra) {
  try {
    const takeProfit = precoCompra * (1 + TP_PERCENT);
    const stopPrice = precoCompra * (1 - SL_PERCENT);
    const stopLimit = stopPrice * 0.995;

    console.log(`📌 Criando OCO TP 5% / SL 2%`);

    await client.orderOco({
      symbol,
      side: "SELL",
      quantity: quantidade,
      price: takeProfit.toFixed(6),
      stopPrice: stopPrice.toFixed(6),
      stopLimitPrice: stopLimit.toFixed(6),
      stopLimitTimeInForce: "GTC"
    });

    console.log("✅ OCO criado com sucesso");

  } catch (err) {
    console.log("Erro OCO:", err.message);
  }
}

/* ================= SCAN ================= */

async function scan() {
  if (operando) return;

  try {
    console.log("🔎 Buscando moedas...");

    const tickers = await client.dailyStats();
    const top = tickers
      .filter(t => t.symbol.endsWith("USDT"))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, MAX_MOEDAS);

    for (let moeda of top) {
      const klines = await client.candles({
        symbol: moeda.symbol,
        interval: INTERVALO,
        limit: 50
      });

      const closes = klines.map(k => parseFloat(k.close));

      const ema9 = calcularEMA(9, closes);
      const ema21 = calcularEMA(21, closes);
      const rsi = calcularRSI(14, closes);
      const precoAtual = closes[closes.length - 1];

      console.log(
        `${moeda.symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`
      );

      if (
        ema9 > ema21 &&
        Math.abs(precoAtual - ema21) / ema21 < 0.01 &&
        rsi < 40
      ) {
        console.log(`🔥 SINAL DE COMPRA EM ${moeda.symbol}`);
        await executarCompra(moeda.symbol);
        break;
      }
    }

  } catch (err) {
    console.log("Erro no scan:", err.message);
  }
}

setInterval(scan, SCAN_INTERVAL);