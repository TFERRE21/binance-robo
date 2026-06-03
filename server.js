```javascript
require("dotenv").config();

const Binance =
  require("binance-api-node").default;

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET
});

/* ================= CONFIG ================= */

const INTERVALO = "15m";
const INTERVALO_TENDENCIA = "1d";

const MAX_MOEDAS = 25;

const TAKE_PROFIT = 0.05;
const QUEDA_PARA_COMPRAR = 0.03;

const PERCENTUAL_ENTRADA = 0.95;

const TEMPO_MONITORAMENTO = 15000;

const TEMPO_MAXIMO_ESPERA =
  2 * 60 * 60 * 1000;

let operando = false;

const monitorando = new Set();

/* ================= BLOQUEIOS ================= */

const BLOQUEADAS = [
  "USD","EUR","TRY","BRL","GBP","AUD",
  "BULL","BEAR","UP","DOWN",
  "USDC","FDUSD","TUSD","DAI",
  "RLUSD","UUSDT","U/USDT"
];

const UM_ANO_MS =
  365 * 24 * 60 * 60 * 1000;

/* ================= FUNÇÕES ================= */

function sleep(ms){

  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

function ema(values, period){

  const k = 2 / (period + 1);

  let e = values[0];

  for(let i = 1; i < values.length; i++){

    e =
      values[i] * k +
      e * (1 - k);
  }

  return e;
}

function rsi(values, period = 14){

  let ganhos = 0;
  let perdas = 0;

  for(
    let i = values.length - period;
    i < values.length - 1;
    i++
  ){

    const diff =
      values[i + 1] - values[i];

    if(diff >= 0){

      ganhos += diff;

    }else{

      perdas -= diff;
    }
  }

  if(perdas === 0){
    return 100;
  }

  const rs = ganhos / perdas;

  return 100 - (100 / (1 + rs));
}

function ajustar(valor, step){

  const precision =
    Math.round(-Math.log10(step));

  return parseFloat(
    (
      Math.floor(valor / step) * step
    ).toFixed(precision)
  );
}

/* ================= VERIFICAÇÕES ================= */

async function temPosicao(symbol){

  const asset =
    symbol.replace("USDT","");

  const acc =
    await client.accountInfo();

  const saldo = parseFloat(
    acc.balances.find(
      b => b.asset === asset
    )?.free || 0
  );

  return saldo > 0;
}

async function temOrdemAberta(symbol){

  const ordens =
    await client.openOrders({
      symbol
    });

  return ordens.length > 0;
}

/* ================= VALIDAR SETUP ================= */

async function validarSetup(symbol){

  try{

    const candles1d =
      await client.candles({
        symbol,
        interval: INTERVALO_TENDENCIA,
        limit: 50
      });

    const closes1d =
      candles1d.map(
        c => parseFloat(c.close)
      );

    const ema21_1d =
      ema(closes1d.slice(-21),21);

    const preco1d =
      closes1d[
        closes1d.length - 1
      ];

    if(preco1d < ema21_1d){

      return {
        valido: false,
        motivo: "Tendência baixa 1D"
      };
    }

    const candles =
      await client.candles({
        symbol,
        interval: INTERVALO,
        limit: 50
      });

    const closes =
      candles.map(
        c => parseFloat(c.close)
      );

    const opens =
      candles.map(
        c => parseFloat(c.open)
      );

    const volumes =
      candles.map(
        c => parseFloat(c.volume)
      );

    const ema9 =
      ema(closes.slice(-9),9);

    const ema21 =
      ema(closes.slice(-21),21);

    const r =
      rsi(closes,14);

    const precoAtual =
      closes[closes.length - 1];

    const openAtual =
      opens[opens.length - 1];

    const volumeAtual =
      volumes[volumes.length - 1];

    const volumeMedio =
      volumes
        .slice(-20)
        .reduce((a,b)=>a+b,0) / 20;

    const candlePositivo =
      precoAtual > openAtual;

    const distanciaEMA21 =
      Math.abs(
        (
          precoAtual - ema21
        ) / ema21
      );

    let motivo = "";

    if(ema9 < ema21){

      motivo =
        "Sem tendência 15m";

    }else if(r > 55){

      motivo = "RSI alto";

    }else if(
      distanciaEMA21 > 0.01
    ){

      motivo =
        "Muito longe EMA21";

    }else if(!candlePositivo){

      motivo =
        "Candle negativo";

    }else if(
      volumeAtual < volumeMedio
    ){

      motivo =
        "Volume fraco";
    }

    if(motivo){

      return {
        valido: false,
        motivo
      };
    }

    return {
      valido: true,
      precoAtual
    };

  }catch(err){

    return {
      valido: false,
      motivo: err.message
    };
  }
}

/* ================= COMPRA ================= */

async function comprar(symbol){

  if(operando) return;

  if(await temPosicao(symbol)) return;

  if(await temOrdemAberta(symbol)) return;

  try{

    operando = true;

    const acc =
      await client.accountInfo();

    const saldoUSDT = parseFloat(
      acc.balances.find(
        b => b.asset === "USDT"
      )?.free || 0
    );

    if(saldoUSDT < 15){

      console.log(
        "❌ Saldo insuficiente."
      );

      operando = false;

      return;
    }

    const precoAtual =
      parseFloat(
        (
          await client.prices({
            symbol
          })
        )[symbol]
      );

    console.log(
      "🟢 COMPRANDO",
      symbol
    );

    await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quoteOrderQty:
        saldoUSDT *
        PERCENTUAL_ENTRADA
    });

    console.log(
      "✅ COMPRA REALIZADA"
    );

  }catch(err){

    console.log(
      "❌ Erro:",
      err.body || err.message
    );

  }finally{

    operando = false;
  }
}

/* ================= MONITORAMENTO ================= */

async function monitorarQueda(
  symbol,
  precoReferencia
){

  if(monitorando.has(symbol)){
    return;
  }

  monitorando.add(symbol);

  const precoAlvo =
    precoReferencia *
    (1 - QUEDA_PARA_COMPRAR);

  console.log(
    "\n👀 MONITORANDO",
    symbol
  );

  const inicio = Date.now();

  while(true){

    try{

      if(operando){

        await sleep(5000);
        continue;
      }

      const precoAtual =
        parseFloat(
          (
            await client.prices({
              symbol
            })
          )[symbol]
        );

      console.log(
        symbol,
        precoAtual
      );

      if(precoAtual <= precoAlvo){

        const revalidacao =
          await validarSetup(symbol);

        if(revalidacao.valido){

          await comprar(symbol);
        }

        monitorando.delete(symbol);

        return;
      }

      const tempoDecorrido =
        Date.now() - inicio;

      if(
        tempoDecorrido >=
        TEMPO_MAXIMO_ESPERA
      ){

        monitorando.delete(symbol);

        return;
      }

      await sleep(
        TEMPO_MONITORAMENTO
      );

    }catch(err){

      console.log(
        "❌ Monitoramento:",
        err.message
      );

      monitorando.delete(symbol);

      return;
    }
  }
}

/* ================= ROBÔ ================= */

async function iniciar(){

  while(true){

    try{

      console.log(
        "\n🔎 VARREDURA TOP 25\n"
      );

      const exchangeInfo =
        await client.exchangeInfo();

      const tickers =
        await client.dailyStats();

      const agora = Date.now();

      const pares = tickers

        .filter(t => {

          if(
            !t.symbol.endsWith("USDT")
          ){
            return false;
          }

          const info =
            exchangeInfo.symbols.find(
              s => s.symbol === t.symbol
            );

          if(!info){
            return false;
          }

          const base =
            info.baseAsset;

          if(
            BLOQUEADAS.some(
              b => base.startsWith(b)
            )
          ){
            return false;
          }

          if(info.onboardDate){

            if(
              agora - info.onboardDate <
              UM_ANO_MS
            ){
              return false;
            }
          }

          return true;
        })

        .sort(
          (a,b) =>
            parseFloat(
              b.quoteVolume
            ) -
            parseFloat(
              a.quoteVolume
            )
        )

        .slice(0, MAX_MOEDAS);

      for(const par of pares){

        if(monitorando.has(par.symbol)){
          continue;
        }

        console.log(
          "➡️",
          par.symbol
        );

        const setup =
          await validarSetup(
            par.symbol
          );

        if(!setup.valido){

          console.log(
            "❌",
            setup.motivo
          );

          continue;
        }

        console.log(
          "✅ SETUP",
          par.symbol
        );

        monitorarQueda(
          par.symbol,
          setup.precoAtual
        );
      }

    }catch(err){

      console.log(
        "❌ Erro:",
        err.message
      );
    }

    console.log(
      "\n⏳ NOVA VARREDURA EM 15m\n"
    );

    await sleep(900000);
  }
}

console.log(
  "🔥 ROBÔ ATIVO"
);

iniciar();
```
