require("dotenv").config();
const express = require("express");
const Binance = require("binance-api-node").default;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "online",
    estrategia: "EMA 9/21 + RSI",
    entrada: "$19",
    tp: "5%",
    stop: "3%"
  });
});

app.listen(PORT, () => {
  console.log("🚀 Painel rodando na porta:", PORT);
  console.log("🔥 ROBO EMA 9/21 + RSI INICIADO");
});

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
});

const USDT_ENTRADA = 19;
const TAKE_PROFIT = 1.05; // 5%
const STOP_LOSS = 0.97;   // 3%
const INTERVALO = 2 * 60 * 1000; // 2 minutos

let operando = false;

// ================= INDICADORES =================

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
    if (diff > 0) ganhos += diff;
    else perdas += Math.abs(diff);
  }

  if (perdas === 0) return 100;

  const rs = ganhos / perdas;
  return 100 - 100 / (1 + rs);
}

// ================= LÓGICA PRINCIPAL =================

async function buscarMoedas() {
  if (operando) return;

  console.log("🔎 Buscando moedas ALPHA...");

  const prices = await client.prices();
  const symbols = Object.keys(prices)
    .filter(s => s.endsWith("USDT"))
    .slice(0, 35); // pesquisa 35 moedas

  for (let symbol of symbols) {
    try {
      const candles = await client.candles({
        symbol,
        interval: "5m",
        limit: 30,
      });

      const closes = candles.map(c => parseFloat(c.close));
      const ema9 = calcularEMA(9, closes);
      const ema21 = calcularEMA(21, closes);
      const rsi = calcularRSI(14, closes);
      const preco = closes[closes.length - 1];

      console.log(`${symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`);

      if (
        ema9 > ema21 &&
        rsi < 40 &&
        preco > ema21
      ) {
        console.log(`🚀 SINAL DE COMPRA EM ${symbol}`);
        await comprar(symbol, preco);
        break;
      }

    } catch (err) {
      console.log("Erro em", symbol);
    }
  }
}

async function comprar(symbol, preco) {
  operando = true;

  const quantidade = (USDT_ENTRADA / preco).toFixed(3);

  const ordem = await client.order({
    symbol,
    side: "BUY",
    type: "MARKET",
    quantity: quantidade,
  });

  console.log("✅ COMPRA EXECUTADA:", symbol);

  setTimeout(async () => {
    await criarOCO(symbol);
  }, 3000);
}

async function criarOCO(symbol) {
  const account = await client.accountInfo();
  const asset = symbol.replace("USDT", "");

  const saldo = account.balances.find(b => b.asset === asset);

  if (!saldo || parseFloat(saldo.free) <= 0) {
    console.log("❌ Sem saldo para vender.");
    operando = false;
    return;
  }

  const quantidade = parseFloat(saldo.free);

  const precoAtual = parseFloat((await client.prices({ symbol }))[symbol]);

  const take = (precoAtual * TAKE_PROFIT).toFixed(4);
  const stop = (precoAtual * STOP_LOSS).toFixed(4);
  const stopLimit = (stop * 0.999).toFixed(4);

  await client.orderOco({
    symbol,
    side: "SELL",
    quantity: quantidade,
    price: take,
    stopPrice: stop,
    stopLimitPrice: stopLimit,
    stopLimitTimeInForce: "GTC",
  });

  console.log("🎯 OCO CRIADA COM SUCESSO");
  operando = false;
}

// ================= LOOP =================

setInterval(buscarMoedas, INTERVALO);