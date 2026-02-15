require("dotenv").config();
const Binance = require("binance-api-node").default;
const express = require("express");

const app = express();

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
});

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */

const INTERVALO = "5m";
const TAKE_PROFIT = 0.05;     // 5%
const STOP_LOSS = 0.02;       // 2%
const USAR_PERCENTUAL = 0.9;  // 90% saldo
const MAX_MOEDAS = 35;
const INTERVALO_ANALISE = 120000;

let operando = false;

/* ========= EXCLUIR TOP 10 ========= */

const TOP_EXCLUIDAS = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT",
  "XRPUSDT","ADAUSDT","DOGEUSDT","TRXUSDT",
  "TONUSDT","AVAXUSDT"
];

/* ================= INDICADORES ================= */

function calcularEMA(periodo, closes) {
  const k = 2 / (periodo + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcularRSI(closes, periodo = 14) {
  let ganhos = 0;
  let perdas = 0;

  for (let i = 1; i <= periodo; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) ganhos += diff;
    else perdas += Math.abs(diff);
  }

  if (perdas === 0) return 100;

  const rs = ganhos / perdas;
  return 100 - 100 / (1 + rs);
}

/* ================= SALDO ================= */

async function obterSaldoUSDT() {
  const conta = await client.accountInfo();
  const usdt = conta.balances.find(b => b.asset === "USDT");
  return usdt ? parseFloat(usdt.free) : 0;
}

/* ================= COMPRA + OCO ================= */

async function executarCompra(symbol) {
  try {
    symbol = String(symbol).trim().replace(/[^A-Z0-9]/g, "");

    const saldoUSDT = await obterSaldoUSDT();
    const valorEntrada = saldoUSDT * USAR_PERCENTUAL;

    if (valorEntrada <= 10) {
      console.log("❌ Saldo insuficiente");
      return;
    }

    const ticker = await client.prices(symbol);
    const precoEntrada = parseFloat(ticker[symbol]);

    const exchangeInfo = await client.exchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);

    const lotFilter = symbolInfo.filters.find(f => f.filterType === "LOT_SIZE");
    const minNotionalFilter = symbolInfo.filters.find(f => f.filterType === "MIN_NOTIONAL");

    const stepSize = parseFloat(lotFilter.stepSize);
    const minQty = parseFloat(lotFilter.minQty);
    const minNotional = parseFloat(minNotionalFilter.minNotional);

    let quantidade = valorEntrada / precoEntrada;
    quantidade = Math.floor(quantidade / stepSize) * stepSize;

    if (quantidade < minQty) {
      console.log("❌ Quantidade menor que minQty");
      return;
    }

    if (quantidade * precoEntrada < minNotional) {
      console.log("❌ Valor menor que minNotional");
      return;
    }

    console.log(`🚀 Comprando ${symbol}...`);

    await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    const precoTP = (precoEntrada * (1 + TAKE_PROFIT)).toFixed(5);
    const precoSL = (precoEntrada * (1 - STOP_LOSS)).toFixed(5);
    const precoSLTrigger = (precoEntrada * (1 - STOP_LOSS * 0.9)).toFixed(5);

    await client.orderOco({
      symbol,
      side: "SELL",
      quantity: quantidade,
      price: precoTP,
      stopPrice: precoSLTrigger,
      stopLimitPrice: precoSL,
      stopLimitTimeInForce: "GTC"
    });

    console.log("📦 OCO enviado (TP + SL)");

  } catch (err) {
    console.log("❌ Erro na compra:", err.message);
  } finally {
    operando = false;
  }
}

/* ================= ROBÔ ================= */

async function iniciarRobo() {
  while (true) {
    try {
      if (operando) {
        await new Promise(r => setTimeout(r, INTERVALO_ANALISE));
        continue;
      }

      const saldo = await obterSaldoUSDT();
      console.log("💰 Saldo USDT:", saldo);

      const exchangeInfo = await client.exchangeInfo();
      let pares = exchangeInfo.symbols
        .filter(s => s.quoteAsset === "USDT" && s.status === "TRADING")
        .map(s => s.symbol)
        .filter(s => !TOP_EXCLUIDAS.includes(s))
        .slice(0, MAX_MOEDAS);

      for (let symbol of pares) {
        const candles = await client.candles({
          symbol,
          interval: INTERVALO,
          limit: 50
        });

        const closes = candles.map(c => parseFloat(c.close));

        if (closes.length < 21) continue;

        const ema9 = calcularEMA(9, closes.slice(-9));
        const ema21 = calcularEMA(21, closes.slice(-21));
        const rsi = calcularRSI(closes.slice(-15));

        console.log(`${symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`);

        if (ema9 > ema21 && rsi > 40 && rsi < 60) {
          operando = true;
          await executarCompra(symbol);
          break;
        }
      }

    } catch (err) {
      console.log("Erro geral:", err.message);
    }

    await new Promise(r => setTimeout(r, INTERVALO_ANALISE));
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