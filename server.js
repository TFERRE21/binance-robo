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
const TAKE_PROFIT = 0.05;  // 5%
const STOP_LOSS = 0.025;   // 2.5%

let operando = false;

/* ================= EXCLUSÕES ================= */

const TOP10_EXCLUIR = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
  "ADAUSDT","DOGEUSDT","AVAXUSDT","DOTUSDT","TRXUSDT"
];

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

/* ================= COMPRA + OCO ================= */

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

    const precisionQty = Math.round(-Math.log10(stepSize));
    const precisionPrice = Math.round(-Math.log10(tickSize));

    const ajustarQuantidade = (qty) =>
      (Math.floor(qty / stepSize) * stepSize).toFixed(precisionQty);

    const ajustarPreco = (price) =>
      (Math.floor(price / tickSize) * tickSize).toFixed(precisionPrice);

    const quantidade = ajustarQuantidade(valorCompra / precoAtual);

    console.log(`🟢 COMPRANDO ${symbol}`);

    const ordem = await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    await sleep(2000);

    const accountAtualizado = await client.accountInfo();
    const assetBase = symbol.replace("USDT", "");

    const saldoMoeda = parseFloat(
      accountAtualizado.balances.find(b => b.asset === assetBase)?.free || 0
    );

    const quantidadeReal = ajustarQuantidade(saldoMoeda);

    if(quantidadeReal <= 0){
      console.log("Erro: quantidade real inválida.");
      operando = false;
      return;
    }

    const precoEntrada = parseFloat(ordem.fills[0].price);

    const precoTP = ajustarPreco(precoEntrada * (1 + TAKE_PROFIT));
    const precoSL = ajustarPreco(precoEntrada * (1 - STOP_LOSS));
    const precoSLTrigger = ajustarPreco(precoEntrada * (1 - STOP_LOSS * 0.98));

    console.log(`🎯 TP: ${precoTP}`);
    console.log(`🛑 SL: ${precoSL}`);

    await client.orderOco({
      symbol,
      side: "SELL",
      quantity: quantidadeReal,
      price: precoTP,
      stopPrice: precoSLTrigger,
      stopLimitPrice: precoSL,
      stopLimitTimeInForce: "GTC"
    });

    console.log("✅ OCO enviado corretamente!");

  }catch(err){
    console.log("❌ Erro na compra/OCO:", err.message);
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
          !TOP10_EXCLUIR.includes(s.symbol) &&
          !STABLES.some(st => s.baseAsset.includes(st))
        )
        .slice(0, MAX_MOEDAS);

      console.log(`📊 Analisando ${pares.length} moedas`);

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

        if(closes.some(isNaN)) continue;

        const ema9 = calcularEMA(closes.slice(-9), 9);
        const ema21 = calcularEMA(closes.slice(-21), 21);
        const rsi = calcularRSI(closes, 14);

        const precoAtual = closes[closes.length - 1];
        const volumeAtual = volumes[volumes.length - 1];
        const volumeMedio =
          volumes.slice(-20).reduce((a,b)=>a+b,0)/20;

        console.log(
          `${par.symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`
        );

        const entrada =
          ema9 > ema21 &&
          rsi > 45 &&
          rsi < 60 &&
          precoAtual > ema9 &&
          volumeAtual > volumeMedio;

        if(entrada){
          console.log(`🚀 SINAL DETECTADO EM ${par.symbol}`);
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
  res.send("ROBÔ ONLINE");
});

app.listen(PORT, ()=>{
  console.log("🔥 ROBÔ 5% + OCO DEFINITIVO ATIVO");
  iniciarRobo();
});