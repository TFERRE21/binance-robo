require("dotenv").config();
const Binance = require("binance-api-node").default;
const express = require("express");

const app = express();

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

const PERCENTUAL_ENTRADA = 0.90;
const TAKE_PROFIT = 0.035;  // 3.5%
const STOP_LOSS = 0.025;    // 2.5%

let operando = false;

/* ================= EXCLUSÕES ================= */

const STABLES = ["USDC","BUSD","FDUSD","TUSD","DAI"];

/* ================= AUX ================= */

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
  return (Math.floor(valor / step) * step);
}

/* ================= COMPRA + TP + STOP ================= */

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
    const minNotionalFilter = symbolInfo.filters.find(f => f.filterType === "MIN_NOTIONAL");

    const stepSize = parseFloat(lotFilter.stepSize);
    const tickSize = parseFloat(priceFilter.tickSize);
    const minNotional = parseFloat(minNotionalFilter.minNotional);

    let quantidade = ajustarStep(valorCompra / precoAtual, stepSize);

    if(quantidade * precoAtual < minNotional){
      console.log("Valor menor que MIN_NOTIONAL");
      operando = false;
      return;
    }

    console.log(`🟢 COMPRANDO ${symbol}`);

    const ordemCompra = await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    await sleep(3000);

    const assetBase = symbol.replace("USDT", "");
    const accountAtualizado = await client.accountInfo();
    const saldoMoeda = parseFloat(
      accountAtualizado.balances.find(b => b.asset === assetBase)?.free || 0
    );

    quantidade = ajustarStep(saldoMoeda, stepSize);

    if(quantidade <= 0){
      console.log("Quantidade inválida após compra.");
      operando = false;
      return;
    }

    const precoEntrada = parseFloat(ordemCompra.fills[0].price);

    const precoTP = ajustarStep(precoEntrada * (1 + TAKE_PROFIT), tickSize);
    const precoStop = ajustarStep(precoEntrada * (1 - STOP_LOSS), tickSize);
    const precoStopLimit = ajustarStep(precoStop * 0.999, tickSize);

    console.log(`🎯 TP: ${precoTP}`);
    console.log(`🛑 STOP: ${precoStop}`);

    // ORDEM TAKE PROFIT
    await client.order({
      symbol,
      side: "SELL",
      type: "LIMIT",
      quantity: quantidade,
      price: precoTP.toFixed(8),
      timeInForce: "GTC"
    });

    // ORDEM STOP LOSS
    await client.order({
      symbol,
      side: "SELL",
      type: "STOP_LOSS_LIMIT",
      quantity: quantidade,
      price: precoStopLimit.toFixed(8),
      stopPrice: precoStop.toFixed(8),
      timeInForce: "GTC"
    });

    console.log("✅ TP e STOP enviados com sucesso!");

  }catch(err){
    console.log("❌ Erro:", err.body || err.message);
  }finally{
    operando = false;
  }
}

/* ================= ROBÔ ================= */

async function iniciarRobo(){

  while(true){

    try{

      console.log("🔎 Buscando TOP 40 por volume...");

      const tickers = await client.dailyStats();

      const pares = tickers
        .filter(t =>
          t.symbol.endsWith("USDT") &&
          !STABLES.some(st => t.symbol.includes(st))
        )
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, MAX_MOEDAS)
        .map(t => ({ symbol: t.symbol }));

      for(const par of pares){

        if(operando) break;

        const candles = await client.candles({
          symbol: par.symbol,
          interval: INTERVALO,
          limit: 100
        });

        if(!candles || candles.length < 50) continue;

        const closes = candles.map(c => parseFloat(c.close));
        const volumes = candles.map(c => parseFloat(c.volume));

        const ema9 = calcularEMA(closes.slice(-9), 9);
        const ema21 = calcularEMA(closes.slice(-21), 21);
        const rsi = calcularRSI(closes, 14);

        const precoAtual = closes[closes.length - 1];
        const volumeAtual = volumes[volumes.length - 1];
        const volumeMedio =
          volumes.slice(-20).reduce((a,b)=>a+b,0)/20;

        const entrada =
          ema9 > ema21 &&
          rsi > 45 &&
          rsi < 60 &&
          precoAtual > ema9 &&
          volumeAtual > volumeMedio;

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

app.get("/", (req,res)=>{
  res.send("ROBÔ TOP 40 COM TP + STOP ATIVO");
});

app.listen(PORT, ()=>{
  console.log("🔥 ROBÔ DEFINITIVO ATIVO");
  iniciarRobo();
});
