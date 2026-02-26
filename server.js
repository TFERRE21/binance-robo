require("dotenv").config();
const Binance = require("binance-api-node").default;
const express = require("express");

const app = express();

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET
});

const PORT = process.env.PORT || 3000;

const INTERVALO = "5m";
const TAKE_PROFIT = 0.035;
const MAX_MOEDAS = 40;

let operando = false;

/* ========= BLOQUEIOS ========= */

const BLOQUEADAS = [
  "USDC","BUSD","FDUSD","TUSD","DAI",
  "EUR","TRY","BRL","GBP","AUD",
  "UP","DOWN","BULL","BEAR"
];

/* ========= FUNÇÕES ========= */

function sleep(ms){
  return new Promise(r => setTimeout(r, ms));
}

function calcularEMA(values, period){
  const k = 2 / (period + 1);
  let ema = values[0];
  for(let i = 1; i < values.length; i++){
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcularRSI(values, period = 14){
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

function ajustarStep(valor, step){
  const precision = Math.round(-Math.log10(step));
  return parseFloat((Math.floor(valor / step) * step).toFixed(precision));
}

/* ========= VERIFICAÇÕES ========= */

async function jaTemPosicao(symbol){
  const asset = symbol.replace("USDT","");
  const account = await client.accountInfo();
  const saldo = parseFloat(
    account.balances.find(b => b.asset === asset)?.free || 0
  );
  return saldo > 0;
}

async function jaTemOrdemAberta(symbol){
  const ordens = await client.openOrders({ symbol });
  return ordens.length > 0;
}

/* ========= COMPRA ========= */

async function executarCompra(symbol){

  if(operando) return;
  if(await jaTemPosicao(symbol)) return;
  if(await jaTemOrdemAberta(symbol)) return;

  try{
    operando = true;

    const account = await client.accountInfo();
    const saldoUSDT = parseFloat(
      account.balances.find(b => b.asset === "USDT")?.free || 0
    );

    if(saldoUSDT < 10){
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

    let quantidade = saldoUSDT * 0.9 / precoAtual;
    quantidade = ajustarStep(quantidade, stepSize);

    console.log(`🟢 COMPRANDO ${symbol}`);

    const ordem = await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    await sleep(2000);

    const precoEntrada = parseFloat(ordem.fills[0].price);

    let precoVenda = precoEntrada * (1 + TAKE_PROFIT);
    precoVenda = ajustarStep(precoVenda, tickSize);

    console.log(`🎯 VENDA EM: ${precoVenda}`);

    await client.order({
      symbol,
      side: "SELL",
      type: "LIMIT",
      quantity: quantidade,
      price: precoVenda,
      timeInForce: "GTC"
    });

    console.log("✅ ORDEM DE VENDA CRIADA");

  }catch(err){
    console.log("Erro:", err.body || err.message);
  }finally{
    operando = false;
  }
}

/* ========= ROBÔ ========= */

async function iniciarRobo(){

  while(true){

    try{

      const exchangeInfo = await client.exchangeInfo();
      const tickers = await client.dailyStats();

      const pares = tickers
        .filter(t => {

          if(!t.symbol.endsWith("USDT")) return false;

          const info = exchangeInfo.symbols.find(s => s.symbol === t.symbol);
          if(!info) return false;

          const base = info.baseAsset;

          if(BLOQUEADAS.some(b => base.includes(b))) return false;

          return true;
        })
        .sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, MAX_MOEDAS);

      for(const par of pares){

        if(operando) break;

        const candles = await client.candles({
          symbol: par.symbol,
          interval: INTERVALO,
          limit: 50
        });

        const closes = candles.map(c => parseFloat(c.close));

        const ema9 = calcularEMA(closes.slice(-9),9);
        const ema21 = calcularEMA(closes.slice(-21),21);
        const rsi = calcularRSI(closes,14);

        if(ema9 > ema21 && rsi > 45 && rsi < 60){
          console.log(`🚀 SINAL EM ${par.symbol}`);
          await executarCompra(par.symbol);
          break;
        }
      }

    }catch(err){
      console.log("Erro geral:", err.message);
    }

    await sleep(60000);
  }
}

app.listen(PORT, ()=>{
  console.log("🔥 ROBÔ ESTÁVEL ATIVO");
  iniciarRobo();
});
