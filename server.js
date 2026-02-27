require("dotenv").config();
const Binance = require("binance-api-node").default;

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET
});

/* ================= CONFIG ================= */

const INTERVALO = "5m";
const MAX_MOEDAS = 30;
const TAKE_PROFIT = 0.035; // 3.5%
const PERCENTUAL_ENTRADA = 0.90;

let operando = false;

/* ================= BLOQUEIO TOTAL ================= */

const BLOQUEADAS = [
  "USD",   // bloqueia USD1, USDJ, USDC etc
  "EUR",
  "TRY",
  "BRL",
  "GBP",
  "AUD",
  "BULL",
  "BEAR",
  "UP",
  "DOWN"
];

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

    const info = (await client.exchangeInfo()).symbols.find(s => s.symbol === symbol);

    if(!info){
      operando = false;
      return;
    }

    const lot = info.filters.find(f => f.filterType === "LOT_SIZE");
    const priceFilter = info.filters.find(f => f.filterType === "PRICE_FILTER");

    const stepSize = parseFloat(lot.stepSize);
    const tickSize = parseFloat(priceFilter.tickSize);

    let quantidade = saldoUSDT * PERCENTUAL_ENTRADA / precoAtual;
    quantidade = ajustar(quantidade, stepSize);

    console.log("🟢 COMPRANDO", symbol);

    const ordem = await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    await sleep(2000);

    const precoEntrada = parseFloat(ordem.fills[0].price);

    let precoVenda = precoEntrada * (1 + TAKE_PROFIT);
    precoVenda = ajustar(precoVenda, tickSize);

    console.log("🎯 VENDA EM:", precoVenda);

    await client.order({
      symbol,
      side: "SELL",
      type: "LIMIT",
      quantity: quantidade,
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

      const exchangeInfo = await client.exchangeInfo();
      const tickers = await client.dailyStats();

      const pares = tickers
        .filter(t => {

          if(!t.symbol.endsWith("USDT")) return false;

          const info = exchangeInfo.symbols.find(s => s.symbol === t.symbol);
          if(!info) return false;

          const base = info.baseAsset;

          // BLOQUEIO DEFINITIVO
          if(BLOQUEADAS.some(b => base.startsWith(b))) return false;

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

        const ema9 = ema(closes.slice(-9),9);
        const ema21 = ema(closes.slice(-21),21);
        const r = rsi(closes,14);

        if(ema9 > ema21 && r > 45 && r < 60){
          console.log("🚀 SINAL EM", par.symbol);
          await comprar(par.symbol);
          break;
        }
      }

    }catch(err){
      console.log("Erro geral:", err.message);
    }

    await sleep(60000);
  }
}

console.log("🔥 ROBÔ 3.5% ESTÁVEL ATIVO");
iniciar();
