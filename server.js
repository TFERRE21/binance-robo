require("dotenv").config();
const Binance = require("binance-api-node").default;

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET
});

/* ================= CONFIG ================= */

const INTERVALO = "15m";
const INTERVALO_TENDENCIA = "1d"; // NOVO
const MAX_MOEDAS = 30; // TOP 30
const TAKE_PROFIT = 0.035;
const PERCENTUAL_ENTRADA = 0.95;

let operando = false;

/* ================= BLOQUEIOS ================= */

const BLOQUEADAS = [
  "USD","EUR","TRY","BRL","GBP","AUD",
  "BULL","BEAR","UP","DOWN",
  "USDC","FDUSD","TUSD","DAI"
];

const UM_ANO_MS = 365 * 24 * 60 * 60 * 1000;

/* ================= FUNÇÕES ================= */

function sleep(ms){
  return new Promise(r => setTimeout(r, ms));
}

function ema(values, period){
  const k = 2 / (period + 1);
  let e = values[0];
  for(let i = 1; i < values.length; i++){
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

function rsi(values, period = 14){
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

function ajustar(valor, step){
  const precision = Math.round(-Math.log10(step));
  return parseFloat((Math.floor(valor / step) * step).toFixed(precision));
}

/* ================= VERIFICAÇÕES ================= */

async function temPosicao(symbol){
  const asset = symbol.replace("USDT","");
  const acc = await client.accountInfo();
  const saldo = parseFloat(
    acc.balances.find(b => b.asset === asset)?.free || 0
  );
  return saldo > 0;
}

async function temOrdemAberta(symbol){
  const ordens = await client.openOrders({ symbol });
  return ordens.length > 0;
}

/* ================= COMPRA ================= */

async function comprar(symbol){

  if(operando) return;
  if(await temPosicao(symbol)) return;
  if(await temOrdemAberta(symbol)) return;

  try{

    operando = true;

    const acc = await client.accountInfo();
    const saldoUSDT = parseFloat(
      acc.balances.find(b => b.asset === "USDT")?.free || 0
    );

    if(saldoUSDT < 15){
      console.log("Saldo insuficiente.");
      operando = false;
      return;
    }

    const precoAtual = parseFloat(
      (await client.prices({ symbol }))[symbol]
    );

    const exchangeInfo = await client.exchangeInfo();
    const info = exchangeInfo.symbols.find(s => s.symbol === symbol);

    const lot = info.filters.find(f => f.filterType === "LOT_SIZE");
    const priceFilter = info.filters.find(f => f.filterType === "PRICE_FILTER");

    const stepSize = parseFloat(lot.stepSize);
    const tickSize = parseFloat(priceFilter.tickSize);

    let quantidadeCompra = saldoUSDT * PERCENTUAL_ENTRADA / precoAtual;
    quantidadeCompra = ajustar(quantidadeCompra, stepSize);

    console.log("🟢 COMPRANDO", symbol);

    await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidadeCompra
    });

    await sleep(3000);

    const asset = symbol.replace("USDT","");
    const accAtualizado = await client.accountInfo();

    let quantidadeReal = parseFloat(
      accAtualizado.balances.find(b => b.asset === asset)?.free || 0
    );

    quantidadeReal = ajustar(quantidadeReal, stepSize);

    const precoEntrada = parseFloat(
      (await client.prices({ symbol }))[symbol]
    );

    let precoVenda = precoEntrada * (1 + TAKE_PROFIT);
    precoVenda = ajustar(precoVenda, tickSize);

    console.log("🎯 VENDA EM:", precoVenda);

    await client.order({
      symbol,
      side: "SELL",
      type: "LIMIT",
      quantity: quantidadeReal,
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

/* ================= ROBÔ ================= */

async function iniciar(){

  while(true){

    try{

      console.log("\n🔎 Varredura...\n");

      const exchangeInfo = await client.exchangeInfo();
      const tickers = await client.dailyStats();
      const agora = Date.now();

      const pares = tickers
        .filter(t => {

          if(!t.symbol.endsWith("USDT")) return false;

          const info = exchangeInfo.symbols.find(s => s.symbol === t.symbol);
          if(!info) return false;

          const base = info.baseAsset;

          if(BLOQUEADAS.some(b => base.startsWith(b))){
            console.log(`${t.symbol} ⛔ BLOQUEADA`);
            return false;
          }

          if(info.onboardDate){
            if(agora - info.onboardDate < UM_ANO_MS){
              return false;
            }
          }

          return true;

        })
        .sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, MAX_MOEDAS);

      console.log("📊 Top 30 moedas\n");

      for(const par of pares){

        if(operando) break;

        /* ================= TENDÊNCIA 1D ================= */

        const candles1d = await client.candles({
          symbol: par.symbol,
          interval: INTERVALO_TENDENCIA,
          limit: 50
        });

        const closes1d = candles1d.map(c => parseFloat(c.close));

        const ema21_1d = ema(closes1d.slice(-21),21);
        const preco1d = closes1d[closes1d.length - 1];

        if(preco1d < ema21_1d){
          console.log(`${par.symbol} ❌ Tendência de baixa no 1D`);
          continue;
        }

        /* ================= ENTRADA 15M ================= */

        const candles = await client.candles({
          symbol: par.symbol,
          interval: INTERVALO,
          limit: 50
        });

        const closes = candles.map(c => parseFloat(c.close));
        const opens = candles.map(c => parseFloat(c.open));
        const volumes = candles.map(c => parseFloat(c.volume));

        const ema9 = ema(closes.slice(-9),9);
        const ema21 = ema(closes.slice(-21),21);
        const r = rsi(closes,14);

        const precoAtual = closes[closes.length - 1];
        const openAtual = opens[opens.length - 1];

        const volumeAtual = volumes[volumes.length - 1];
        const volumeMedio = volumes.slice(-20).reduce((a,b)=>a+b,0)/20;

        const candlePositivo = precoAtual > openAtual;
        const distanciaEMA21 = Math.abs((precoAtual - ema21) / ema21);

        let motivo = "";

        if(ema9 < ema21)
          motivo = "Sem tendência no 15m";

        else if(r > 55)
          motivo = "RSI alto (não é pullback)";

        else if(distanciaEMA21 > 0.01)
          motivo = "Muito longe da EMA21";

        else if(!candlePositivo)
          motivo = "Sem confirmação";

        else if(volumeAtual < volumeMedio)
          motivo = "Volume fraco";

        if(motivo){
          console.log(`${par.symbol} ❌ ${motivo}`);
        }else{
          console.log(`${par.symbol} 🚀 ENTRADA NO PULLBACK`);
          await comprar(par.symbol);
          break;
        }

      }

    }catch(err){
      console.log("Erro:", err.message);
    }

    await sleep(900000);
  }
}

console.log("🔥 ROBÔ PROFISSIONAL PULLBACK + 1D ATIVO");

iniciar();
