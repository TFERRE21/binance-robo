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

const USAR_PERCENTUAL_SALDO = true;
const PERCENTUAL_ENTRADA = 0.90; // 90% do saldo
const INVESTIMENTO_FIXO = 50;

const TAKE_PROFIT = 0.05; // 5%
const STOP_LOSS = 0.03;   // 3%

const INTERVALO_ANALISE = 120000; // 2 minutos
const TIMEFRAME = "5m";
const MAX_MOEDAS = 35;

/* =========================================== */

let operando = false;

/* ========= MOEDAS GRANDES EXCLUIDAS ========= */

const EXCLUIR = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT"
];

/* ============================================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ================= INDICADORES ================= */

function calcularEMA(periodo, valores) {
  const k = 2 / (periodo + 1);
  let ema = valores[0];
  for (let i = 1; i < valores.length; i++) {
    ema = valores[i] * k + ema * (1 - k);
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

  const mediaGanhos = ganhos / periodo;
  const mediaPerdas = perdas / periodo;

  if (mediaPerdas === 0) return 100;

  const rs = mediaGanhos / mediaPerdas;
  return 100 - (100 / (1 + rs));
}

/* ================= SALDO ================= */

async function obterSaldoUSDT() {
  const account = await client.accountInfo();
  const usdt = account.balances.find(b => b.asset === "USDT");
  return parseFloat(usdt.free);
}

/* ================= COMPRA ================= */

async function executarCompra(symbol) {
  try {
    operando = true;

    const saldo = await obterSaldoUSDT();
    console.log("💰 Saldo USDT:", saldo.toFixed(2));

    const valorEntrada = USAR_PERCENTUAL_SALDO
      ? saldo * PERCENTUAL_ENTRADA
      : INVESTIMENTO_FIXO;

    if (valorEntrada < 10) {
      console.log("❌ Valor menor que mínimo da Binance");
      operando = false;
      return;
    }

    const ticker = await client.prices({ symbol });
    const precoAtual = parseFloat(ticker[symbol]);

    const quantidade = (valorEntrada / precoAtual).toFixed(5);

    console.log(`🚀 Comprando ${symbol}...`);

    const ordem = await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    const quantidadeReal = parseFloat(ordem.executedQty);
    const precoEntrada = parseFloat(ordem.fills[0].price);

    console.log("✅ Compra executada");
    console.log("Preço entrada:", precoEntrada);

    const precoTP = (precoEntrada * (1 + TAKE_PROFIT)).toFixed(5);
    const precoSL = (precoEntrada * (1 - STOP_LOSS)).toFixed(5);
    const precoSLTrigger = (precoEntrada * (1 - STOP_LOSS * 0.9)).toFixed(5);

    console.log("🎯 TP:", precoTP);
    console.log("🛑 SL:", precoSL);

    await client.orderOco({
      symbol,
      side: "SELL",
      quantity: quantidadeReal,
      price: precoTP,
      stopPrice: precoSLTrigger,
      stopLimitPrice: precoSL,
      stopLimitTimeInForce: "GTC"
    });

    console.log("📦 OCO enviado com sucesso!");

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
        await sleep(INTERVALO_ANALISE);
        continue;
      }

      const saldo = await obterSaldoUSDT();
      console.log("💰 Saldo USDT:", saldo.toFixed(2));

      const tickers = await client.exchangeInfo();
      const simbolos = tickers.symbols
        .filter(s => 
          s.quoteAsset === "USDT" &&
          s.status === "TRADING" &&
          !EXCLUIR.includes(s.symbol)
        )
        .slice(0, MAX_MOEDAS);

      for (let par of simbolos) {
        const klines = await client.candles({
          symbol: par.symbol,
          interval: TIMEFRAME,
          limit: 50
        });

        const closes = klines.map(k => parseFloat(k.close));
        const volumes = klines.map(k => parseFloat(k.volume));

        const ema9 = calcularEMA(9, closes);
        const ema21 = calcularEMA(21, closes);
        const rsi = calcularRSI(14, closes);

        const ultimoCandle = klines[klines.length - 1];
        const candleVerde = parseFloat(ultimoCandle.close) > parseFloat(ultimoCandle.open);

        const volumeAtual = volumes[volumes.length - 1];
        const volumeMedio = volumes.reduce((a, b) => a + b, 0) / volumes.length;

        console.log(`${par.symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`);

        const entrada =
          ema9 > ema21 &&
          rsi >= 30 &&
          rsi <= 50 &&
          candleVerde &&
          volumeAtual > volumeMedio;

        if (entrada) {
          await executarCompra(par.symbol);
          break;
        }
      }

    } catch (err) {
      console.log("Erro geral:", err.message);
    }

    await sleep(INTERVALO_ANALISE);
  }
}

/* ================= SERVIDOR ================= */

app.get("/", (req, res) => {
  res.send("🤖 ROBO BINANCE ONLINE");
});

app.listen(PORT, () => {
  console.log("🔥 ROBÔ EMA 9/21 + RSI + OCO INICIADO");
  console.log("🌐 Rodando na porta:", PORT);
  iniciarRobo();
});