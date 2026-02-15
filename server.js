require("dotenv").config();
const Binance = require("binance-api-node").default;
const express = require("express");

const app = express();

/* ========= BINANCE COM ENV CORRETO ========= */

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  recvWindow: 60000
});

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */

const INTERVALO = "5m";
const SCAN_INTERVAL = 90000;
const MAX_MOEDAS = 40;

const USAR_PERCENTUAL_SALDO = true;
const PERCENTUAL_ENTRADA = 0.90;

const TAKE_PROFIT = 0.05; // 5%
const STOP_LOSS = 0.03;   // 3%

let operando = false;

/* ========= EXCLUIR TOP 10 ========= */

const TOP_10_EXCLUIR = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
  "ADAUSDT","DOGEUSDT","AVAXUSDT","LINKUSDT","TONUSDT"
];

/* ================= AUX ================= */

function sleep(ms){
  return new Promise(r => setTimeout(r, ms));
}

function calcularEMA(values, period){
  if(values.length < period) return null;

  const k = 2 / (period + 1);
  let ema = values[0];

  for(let i = 1; i < values.length; i++){
    ema = values[i] * k + ema * (1 - k);
  }

  return ema;
}

function calcularRSI(values, period = 14){
  if(values.length < period + 1) return null;

  let ganhos = 0;
  let perdas = 0;

  for(let i = values.length - period; i < values.length - 1; i++){
    const diff = values[i + 1] - values[i];
    if(diff >= 0) ganhos += diff;
    else perdas -= diff;
  }

  if(perdas === 0) return 100;

  const rs = ganhos / perdas;
  return 100 - (100 / (1 + rs));
}

/* ================= COMPRA COM OCO ================= */

async function executarCompra(symbol){
  try{
    if(operando) return;
    operando = true;

    const account = await client.accountInfo();
    const saldoUSDT = parseFloat(
      account.balances.find(b => b.asset === "USDT")?.free || 0
    );

    const valorCompra = saldoUSDT * PERCENTUAL_ENTRADA;

    if(valorCompra < 10){
      console.log("Saldo insuficiente.");
      operando = false;
      return;
    }

    const precoAtual = parseFloat(
      (await client.prices({ symbol }))[symbol]
    );

    const exchangeInfo = await client.exchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);

    const lotFilter = symbolInfo.filters.find(f => f.filterType === "LOT_SIZE");
    const priceFilter = symbolInfo.filters.find(f => f.filterType === "PRICE_FILTER");

    const stepSize = parseFloat(lotFilter.stepSize);
    const tickSize = parseFloat(priceFilter.tickSize);

    const ajustarQuantidade = (qty) => {
      const precision = Math.round(-Math.log10(stepSize));
      return (Math.floor(qty / stepSize) * stepSize).toFixed(precision);
    };

    const ajustarPreco = (price) => {
      const precision = Math.round(-Math.log10(tickSize));
      return (Math.floor(price / tickSize) * tickSize).toFixed(precision);
    };

    const quantidade = ajustarQuantidade(valorCompra / precoAtual);

    console.log(`🟢 COMPRANDO ${symbol}`);

    const ordem = await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    const precoEntrada = parseFloat(ordem.fills[0].price);

    const precoTP = ajustarPreco(precoEntrada * (1 + TAKE_PROFIT));
    const precoSL = ajustarPreco(precoEntrada * (1 - STOP_LOSS));
    const precoSLTrigger = ajustarPreco(precoEntrada * (1 - STOP_LOSS * 0.95));

    await sleep(2000);

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

  }catch(err){
    console.log("Erro na compra:", err.message);
  }finally{
    operando = false;
  }
}

/* ================= ROBÔ ================= */

async function iniciarRobo(){
  while(true){
    try{
      console.log("🔎 Escaneando mercado...");

      const exchangeInfo = await client.exchangeInfo();

      const pares = exchangeInfo.symbols
        .filter(s =>
          s.status === "TRADING" &&
          s.quoteAsset === "USDT" &&
          !TOP_10_EXCLUIR.includes(s.symbol)
        )
        .slice(0, MAX_MOEDAS);

      console.log(`📊 Analisando ${pares.length} moedas`);

      for(const par of pares){

        const candles = await client.candles({
          symbol: par.symbol,
          interval: INTERVALO,
          limit: 100
        });

        if(!candles || candles.length < 50) continue;

        const closes = candles.map(c => parseFloat(c.close));
        if(closes.some(isNaN)) continue;

        const ema9 = calcularEMA(closes, 9);
        const ema21 = calcularEMA(closes, 21);
        const rsi = calcularRSI(closes, 14);
        const precoAtual = closes[closes.length - 1];

        if(!ema9 || !ema21 || !rsi) continue;

        console.log(
          `${par.symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`
        );

        const entrada =
          ema9 > ema21 &&
          rsi > 40 &&
          rsi < 60 &&
          precoAtual > ema9;

        if(entrada){
          console.log(`🚀 SINAL EM ${par.symbol}`);
          await executarCompra(par.symbol);
          break;
        }
      }

    }catch(err){
      console.log("Erro geral:", err.message);
    }

    await sleep(SCAN_INTERVAL);
  }
}

/* ================= SERVIDOR ================= */

app.get("/", (req, res)=>{
  res.send("🚀 ROBÔ BINANCE ONLINE");
});

app.listen(PORT, ()=>{
  console.log("🔥 ROBÔ 5% + OCO ATIVO");
  console.log("🌐 Porta:", PORT);
  iniciarRobo();
});