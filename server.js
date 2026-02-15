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
const SCAN_INTERVAL = 120000; // 2 minutos
const MAX_MOEDAS = 35;

const TAKE_PROFIT = 0.05; // 5%
const STOP_LOSS = 0.02;   // 2%

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

  for (let i = 1; i <= periodo; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) ganhos += diff;
    else perdas -= diff;
  }

  if (perdas === 0) return 100;

  const rs = ganhos / perdas;
  return 100 - 100 / (1 + rs);
}

/* ================= FILTRO MOEDAS ================= */

function filtrarMoedas(symbols) {
  const evitar = ["BTC", "ETH", "BNB", "SOL", "XRP"];

  return symbols
    .filter(s =>
      s.symbol.endsWith("USDT") &&
      s.status === "TRADING" &&
      !evitar.some(e => s.symbol.startsWith(e))
    )
    .slice(0, MAX_MOEDAS);
}

/* ================= COMPRA + OCO ================= */

async function executarCompra(symbol) {
  try {
    operando = true;

    const saldo = await client.accountInfo();
    const usdt = saldo.balances.find(b => b.asset === "USDT");
    const saldoDisponivel = parseFloat(usdt.free);

    console.log("💰 Saldo USDT:", saldoDisponivel);

    const valorEntrada = saldoDisponivel * 0.9;

    const ticker = await client.prices({ symbol });
    const precoAtual = parseFloat(ticker[symbol]);

    let quantidade = valorEntrada / precoAtual;

    const exchangeInfo = await client.exchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);

    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === "LOT_SIZE");
    const minNotionalFilter = symbolInfo.filters.find(f => f.filterType === "MIN_NOTIONAL");

    const stepSize = parseFloat(lotSizeFilter.stepSize);
    const minQty = parseFloat(lotSizeFilter.minQty);
    const minNotional = parseFloat(minNotionalFilter.minNotional);

    quantidade = Math.floor(quantidade / stepSize) * stepSize;
    quantidade = parseFloat(quantidade.toFixed(8));

    const valorFinal = quantidade * precoAtual;

    if (quantidade < minQty) {
      console.log("❌ Quantidade menor que minQty");
      operando = false;
      return;
    }

    if (valorFinal < minNotional) {
      console.log("❌ Valor menor que minNotional");
      operando = false;
      return;
    }

    console.log(`🚀 Comprando ${symbol} | QTD: ${quantidade}`);

    const ordemCompra = await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    const quantidadeExecutada = parseFloat(ordemCompra.executedQty);

    const precoMedio =
      ordemCompra.fills.reduce((acc, fill) => acc + parseFloat(fill.price), 0) /
      ordemCompra.fills.length;

    console.log("✅ Compra executada:", quantidadeExecutada);

    const precoTP = (precoMedio * (1 + TAKE_PROFIT)).toFixed(5);
    const precoSL = (precoMedio * (1 - STOP_LOSS)).toFixed(5);
    const precoSLTrigger = (precoMedio * (1 - STOP_LOSS * 0.9)).toFixed(5);

    await client.orderOco({
      symbol,
      side: "SELL",
      quantity: quantidadeExecutada,
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
        await new Promise(r => setTimeout(r, SCAN_INTERVAL));
        continue;
      }

      const saldo = await client.accountInfo();
      const usdt = saldo.balances.find(b => b.asset === "USDT");
      console.log("💰 Saldo USDT:", parseFloat(usdt.free));

      const exchangeInfo = await client.exchangeInfo();
      const moedas = filtrarMoedas(exchangeInfo.symbols);

      for (const par of moedas) {
        const candles = await client.candles({
          symbol: par.symbol,
          interval: INTERVALO,
          limit: 30
        });

        const closes = candles.map(c => parseFloat(c.close));

        const ema9 = calcularEMA(9, closes);
        const ema21 = calcularEMA(21, closes);
        const rsi = calcularRSI(14, closes);

        console.log(`${par.symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`);

        const entrada =
          ema9 > ema21 &&
          rsi < 45 &&
          rsi > 35;

        if (entrada) {
          await executarCompra(par.symbol);
          break;
        }
      }

    } catch (err) {
      console.log("Erro geral:", err.message);
    }

    await new Promise(r => setTimeout(r, SCAN_INTERVAL));
  }
}

/* ================= SERVIDOR ================= */

app.get("/", (req, res) => {
  res.send("🚀 ROBO BINANCE ONLINE");
});

app.listen(PORT, () => {
  console.log("🔥 ROBÔ EMA 9/21 + RSI + OCO INICIADO");
  console.log("🌐 Rodando na porta:", PORT);
  iniciarRobo();
});