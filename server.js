require("dotenv").config();
const Binance = require("node-binance-api");

const client = new Binance().options({
  APIKEY: process.env.API_KEY,
  APISECRET: process.env.API_SECRET,
  useServerTime: true,
  recvWindow: 60000
});

// ================= CONFIG =================

const TAKE_PROFIT = 0.05;     // 5%
const STOP_LOSS = 0.03;       // 3%
const USAR_90_PORCENTO = 0.90;
const INTERVALO = "5m";
const LIMITE_MOEDAS = 35;

let operando = false;

// ==========================================

function calcularEMA(prices, period) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcularRSI(prices, period = 14) {
  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length - 1; i++) {
    const diff = prices[i + 1] - prices[i];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  const rs = gains / (losses || 1);
  return 100 - (100 / (1 + rs));
}

// ==========================================

async function executarCompra(symbol) {
  try {
    if (operando) return;
    operando = true;

    const saldo = await client.balance();
    const usdt = parseFloat(saldo.USDT?.available || 0);

    console.log("💰 Saldo USDT:", usdt);

    if (usdt < 10) {
      operando = false;
      return;
    }

    const valorCompra = usdt * USAR_90_PORCENTO;

    const ticker = await client.prices(symbol);
    const precoAtual = parseFloat(ticker[symbol]);

    let quantidade = valorCompra / precoAtual;

    // ===== BUSCAR FILTROS CORRETAMENTE =====
    const exchangeInfo = await client.exchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);

    if (!symbolInfo) {
      console.log("❌ Símbolo não encontrado:", symbol);
      operando = false;
      return;
    }

    const lotSize = symbolInfo.filters.find(f => f.filterType === "LOT_SIZE");
    const minNotional = symbolInfo.filters.find(f => f.filterType === "MIN_NOTIONAL");

    if (!lotSize || !minNotional) {
      console.log("❌ Filtros não encontrados:", symbol);
      operando = false;
      return;
    }

    const stepSize = parseFloat(lotSize.stepSize);
    const minQty = parseFloat(lotSize.minQty);
    const minNotionalValue = parseFloat(minNotional.minNotional);

    quantidade = Math.floor(quantidade / stepSize) * stepSize;

    if (quantidade < minQty) {
      console.log("❌ Quantidade menor que mínimo permitido");
      operando = false;
      return;
    }

    if (quantidade * precoAtual < minNotionalValue) {
      console.log("❌ Valor menor que mínimo da Binance");
      operando = false;
      return;
    }

    console.log("🚀 Comprando", symbol);

    await client.marketBuy(symbol, quantidade);

    // ===== OCO COM SALDO REAL =====
    setTimeout(async () => {
      const novoSaldo = await client.balance();
      const ativo = symbol.replace("USDT", "");
      const saldoMoeda = parseFloat(novoSaldo[ativo]?.available || 0);

      if (saldoMoeda <= 0) {
        console.log("❌ Nenhuma moeda encontrada para OCO");
        operando = false;
        return;
      }

      const precoTP = (precoAtual * (1 + TAKE_PROFIT)).toFixed(5);
      const precoSL = (precoAtual * (1 - STOP_LOSS)).toFixed(5);
      const precoSLTrigger = (precoAtual * (1 - STOP_LOSS * 0.9)).toFixed(5);

      console.log("🎯 TP:", precoTP);
      console.log("🛑 SL:", precoSL);

      await client.orderOco({
        symbol,
        side: "SELL",
        quantity: saldoMoeda,
        price: precoTP,
        stopPrice: precoSLTrigger,
        stopLimitPrice: precoSL,
        stopLimitTimeInForce: "GTC"
      });

      console.log("📦 OCO enviado com sucesso");

    }, 3000);

  } catch (err) {
    console.log("❌ Erro na compra:", err.message);
  } finally {
    operando = false;
  }
}

// ==========================================

async function analisar() {
  if (operando) return;

  const tickers = await client.prices();
  const pares = Object.keys(tickers)
    .filter(s => s.endsWith("USDT"))
    .slice(0, LIMITE_MOEDAS);

  for (let symbol of pares) {
    try {
      const candles = await client.candlesticks(symbol, INTERVALO, { limit: 50 });
      const closes = candles.map(c => parseFloat(c[4]));

      const ema9 = calcularEMA(closes.slice(-9), 9);
      const ema21 = calcularEMA(closes.slice(-21), 21);
      const rsi = calcularRSI(closes);

      console.log(`${symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`);

      // ===== ESTRATÉGIA =====
      if (ema9 > ema21 && rsi > 45 && rsi < 60) {
        await executarCompra(symbol);
        break;
      }

    } catch (err) {
      console.log("Erro ao analisar", symbol);
    }
  }
}

// ==========================================

setInterval(analisar, 120000);

console.log("🤖 ROBÔ EMA 9/21 + RSI + OCO INICIADO");