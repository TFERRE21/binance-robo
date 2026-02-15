require("dotenv").config();
const Binance = require("binance-api-node").default;
const express = require("express");

const app = express();

// ================= CONEXÃO BINANCE =================

const client = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  recvWindow: 60000
});

// ================= CONFIG =================

const PORT = process.env.PORT || 3000;

const USAR_PERCENTUAL_SALDO = true;
const PERCENTUAL_ENTRADA = 0.90; // 90% saldo
const INVESTIMENTO_FIXO = 19;

const TAKE_PROFIT = 0.05; // 5%
const STOP_LOSS = 0.03;   // 3%

const TIMEFRAME = "5m";
const INTERVALO_ANALISE = 120000;
const MAX_MOEDAS = 35;
const RSI_PERIODO = 14;

let operando = false;

// ================= FUNÇÕES AUXILIARES =================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calcularEMA(valores, periodo) {
  const k = 2 / (periodo + 1);
  let ema = [valores[0]];

  for (let i = 1; i < valores.length; i++) {
    ema.push(valores[i] * k + ema[i - 1] * (1 - k));
  }

  return ema;
}

function calcularRSI(closes, periodo = 14) {
  let ganhos = 0;
  let perdas = 0;

  for (let i = 1; i <= periodo; i++) {
    const diferenca = closes[i] - closes[i - 1];
    if (diferenca >= 0) ganhos += diferenca;
    else perdas -= diferenca;
  }

  let rs = ganhos / perdas;
  let rsi = 100 - (100 / (1 + rs));
  return rsi;
}

// ================= ESTRATÉGIA =================

async function verificarEntrada(symbol) {
  try {
    const candles = await client.candles({
      symbol,
      interval: TIMEFRAME,
      limit: 50
    });

    const closes = candles.map(c => parseFloat(c.close));

    const ema9 = calcularEMA(closes, 9);
    const ema21 = calcularEMA(closes, 21);
    const rsi = calcularRSI(closes.slice(-15));

    const ultimoClose = closes[closes.length - 1];
    const ultimoEMA9 = ema9[ema9.length - 1];
    const ultimoEMA21 = ema21[ema21.length - 1];

    const tendenciaAlta = ultimoEMA9 > ultimoEMA21;
    const tocouEMA21 = Math.abs(ultimoClose - ultimoEMA21) / ultimoEMA21 < 0.003;
    const rsiBaixo = rsi < 40;

    if (tendenciaAlta && tocouEMA21 && rsiBaixo) {
      console.log(`🔥 OPORTUNIDADE EM ${symbol}`);
      return true;
    }

    return false;

  } catch (err) {
    console.log("Erro estratégia:", err.message);
    return false;
  }
}

// ================= EXECUTAR ORDEM =================

async function executarCompra(symbol) {
  try {
    const ticker = await client.prices({ symbol });
    const preco = parseFloat(ticker[symbol]);

    const account = await client.accountInfo();
    const saldoUSDT = parseFloat(
      account.balances.find(b => b.asset === "USDT").free
    );

    const valorInvestir = USAR_PERCENTUAL_SALDO
      ? saldoUSDT * PERCENTUAL_ENTRADA
      : INVESTIMENTO_FIXO;

    const quantidade = (valorInvestir / preco).toFixed(5);

    console.log(`🟢 Comprando ${symbol} - Qtd: ${quantidade}`);

    await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    const take = (preco * (1 + TAKE_PROFIT)).toFixed(5);
    const stop = (preco * (1 - STOP_LOSS)).toFixed(5);
    const stopLimit = (preco * (1 - STOP_LOSS - 0.002)).toFixed(5);

    console.log("📌 Criando OCO");

    await client.orderOco({
      symbol,
      side: "SELL",
      quantity: quantidade,
      price: take,
      stopPrice: stop,
      stopLimitPrice: stopLimit,
      stopLimitTimeInForce: "GTC"
    });

    operando = true;

  } catch (err) {
    console.log("Erro compra:", err.message);
  }
}

// ================= LOOP PRINCIPAL =================

async function iniciarRobo() {
  while (true) {
    try {
      if (!operando) {
        const exchangeInfo = await client.exchangeInfo();
        const paresUSDT = exchangeInfo.symbols
          .filter(s => s.quoteAsset === "USDT" && s.status === "TRADING")
          .slice(0, MAX_MOEDAS);

        for (let par of paresUSDT) {
          const entrada = await verificarEntrada(par.symbol);
          if (entrada) {
            await executarCompra(par.symbol);
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

// ================= SERVIDOR =================

app.get("/", (req, res) => {
  res.send("🚀 ROBO BINANCE ONLINE");
});

app.listen(PORT, () => {
  console.log("🔥 ROBÔ EMA 9/21 + RSI + OCO INICIADO");
  console.log("🌐 Rodando na porta:", PORT);
  iniciarRobo();
});