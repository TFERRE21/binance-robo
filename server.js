require("dotenv").config();
const express = require("express");
const Binance = require("node-binance-api");

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Binance().options({
  APIKEY: process.env.API_KEY,
  APISECRET: process.env.API_SECRET,
  useServerTime: true,
  recvWindow: 60000,
});

const TAKE_PROFIT = 0.05;
const STOP_LOSS = 0.02;
const INTERVALO_ANALISE = 120000; // 2 minutos
const USAR_PERCENTUAL = 0.9;
const LIMITE_MOEDAS = 35;

let operando = false;

const EXCLUIR_TOP10 = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "TRXUSDT",
  "LTCUSDT",
  "BCHUSDT",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calcularEMA(periodo, valores) {
  if (!valores || valores.length < periodo) return null;

  const k = 2 / (periodo + 1);
  let ema = valores[0];

  for (let i = 1; i < valores.length; i++) {
    ema = valores[i] * k + ema * (1 - k);
  }

  return ema;
}

function calcularRSI(periodo, closes) {
  if (!closes || closes.length < periodo + 1) return null;

  let ganhos = 0;
  let perdas = 0;

  for (let i = 1; i <= periodo; i++) {
    const diferenca = closes[i] - closes[i - 1];
    if (diferenca >= 0) ganhos += diferenca;
    else perdas -= diferenca;
  }

  if (perdas === 0) return 100;

  const rs = ganhos / perdas;
  return 100 - 100 / (1 + rs);
}

async function obterSaldoUSDT() {
  const balance = await client.balance();
  return parseFloat(balance.USDT?.available || 0);
}

async function obterMoedas() {
  const info = await client.exchangeInfo();
  return info.symbols
    .filter(
      (s) =>
        s.status === "TRADING" &&
        s.quoteAsset === "USDT" &&
        !EXCLUIR_TOP10.includes(s.symbol)
    )
    .slice(0, LIMITE_MOEDAS);
}

async function executarCompra(symbol) {
  try {
    const saldo = await obterSaldoUSDT();
    const valorEntrada = saldo * USAR_PERCENTUAL;

    const ticker = await client.prices(symbol);
    const preco = parseFloat(ticker[symbol]);

    const exchangeInfo = await client.exchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find(
      (s) => s.symbol === symbol
    );

    const lotFilter = symbolInfo.filters.find(
      (f) => f.filterType === "LOT_SIZE"
    );

    const stepSize = parseFloat(lotFilter.stepSize);
    const minQty = parseFloat(lotFilter.minQty);

    let quantidade = valorEntrada / preco;

    quantidade =
      Math.floor(quantidade / stepSize) * stepSize;

    if (quantidade < minQty) {
      console.log("❌ Quantidade menor que mínimo permitido");
      return;
    }

    console.log(`🚀 Comprando ${symbol}...`);

    await client.marketBuy(symbol, quantidade);

    const precoTP = (preco * (1 + TAKE_PROFIT)).toFixed(6);
    const precoSL = (preco * (1 - STOP_LOSS)).toFixed(6);

    await client.orderOco({
      symbol,
      side: "SELL",
      quantity: quantidade,
      price: precoTP,
      stopPrice: precoSL,
      stopLimitPrice: precoSL,
      stopLimitTimeInForce: "GTC",
    });

    console.log("✅ OCO enviado (TP + SL)");

  } catch (err) {
    console.log("❌ Erro na compra:", err.message);
  }
}

async function iniciarRobo() {
  while (true) {
    try {
      if (!operando) {
        const moedas = await obterMoedas();
        const saldo = await obterSaldoUSDT();
        console.log(`💰 Saldo USDT: ${saldo.toFixed(2)}`);

        for (let par of moedas) {
          const candles = await client.candles({
            symbol: par.symbol,
            interval: "5m",
            limit: 30,
          });

          if (!candles || candles.length < 21) continue;

          const closes = candles.map((c) => parseFloat(c.close));

          const ema9 = calcularEMA(9, closes);
          const ema21 = calcularEMA(21, closes);
          const rsi = calcularRSI(14, closes);

          if (!ema9 || !ema21 || !rsi) continue;

          console.log(
            `${par.symbol} | EMA9:${ema9.toFixed(
              4
            )} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`
          );

          if (
            ema9 > ema21 &&
            rsi > 45 &&
            rsi < 65
          ) {
            operando = true;
            await executarCompra(par.symbol);
            operando = false;
            break;
          }
        }
      }
    } catch (err) {
      console.log("Erro geral:", err.message);
    }

    await sleep(INTERVALO_ANALISE);
  }
}

app.get("/", (req, res) => {
  res.send("🚀 ROBO BINANCE ONLINE");
});

app.listen(PORT, () => {
  console.log("🤖 ROBÔ EMA 9/21 + RSI + OCO INICIADO");
  console.log("🌐 Rodando na porta:", PORT);
  iniciarRobo();
});