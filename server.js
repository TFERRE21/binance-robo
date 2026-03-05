require("dotenv").config();
const Binance = require("binance-api-node").default;

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET
});

/* ================= CONFIG ================= */

const INTERVALO = "15m";
const MAX_MOEDAS = 50;
const TAKE_PROFIT = 0.035;
const PERCENTUAL_ENTRADA = 0.95;

let operando = false;

/* ================= BLOQUEIOS ================= */

const BLOQUEADAS = [
  "USD","EUR","TRY","BRL","GBP","AUD",
  "BULL","BEAR","UP","DOWN"
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

    if(!info){
      operando = false;
      return;
    }

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

    if(quantidadeReal <= 0){
      console.log("Erro: quantidade real inválida.");
      operando = false;
      return;
    }

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

    console.log("✅ ORDEM DE VENDA CRIADA (3.5%)");

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

      console.log("\n🔎 Iniciando varredura do mercado...\n");

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

          /* CORREÇÃO DO FILTRO DE 1 ANO */

          if(info.onboardDate){
            if(agora - info.onboardDate < UM_ANO_MS){
              console.log(`${t.symbol} ⛔ menos de 1 ano na Binance`);
              return false;
            }
          }

          return true;

        })
        .sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, MAX_MOEDAS);

      console.log("📊 Moedas analisadas:", pares.length,"\n");

      for(const par of pares){

        if(operando) break;

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
        const volumeAtual = volumes[volumes.length - 1];

        const volumeMedio =
          volumes.slice(-20).reduce((a,b)=>a+b,0)/20;

        const openAtual = opens[opens.length - 1];

        const candlePositivo = precoAtual > openAtual;

        const distanciaEMA = (ema9 - ema21) / ema21;

        console.log(
          `${par.symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${r.toFixed(2)}`
        );

        let motivo = "";

        if(ema9 <= ema21)
          motivo = "EMA9 abaixo EMA21";

        else if(distanciaEMA < 0.001)
          motivo = "EMAs muito próximas";

        else if(r <= 40 || r >= 70)
          motivo = "RSI fora da faixa";

        else if(precoAtual <= ema9)
          motivo = "Preço abaixo EMA9";

        else if(!candlePositivo)
          motivo = "Candle não positivo";

        else if(volumeAtual <= volumeMedio * 0.8)
          motivo = "Volume baixo";

        if(motivo){

          console.log(`${par.symbol} ❌ ${motivo}`);

        }else{

          console.log(`${par.symbol} 🚀 ENTRADA CONFIRMADA`);

          await comprar(par.symbol);

          break;
        }

      }

    }catch(err){

      console.log("Erro geral:", err.message);

    }

    await sleep(900000);

  }
}

console.log("🔥 ROBÔ 3.5% 15M + FILTRO 1 ANO ATIVO");

iniciar();
