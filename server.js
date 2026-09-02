require("dotenv").config();

const Binance = require("binance-api-node").default;

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET
});

/* =========================================================
   ROBÔ BINANCE — TOP 20 MARKET CAP

   Estratégia flexível para aumentar entradas sem comprar
   indiscriminadamente.

   REGRAS PRINCIPAIS:

   - TOP 20 por capitalização de mercado
   - Somente pares USDT
   - Stablecoins bloqueadas
   - Tokens alavancados bloqueados
   - Ativos com menos de 1 ano bloqueados
   - Tendência 1D e 4H favorável
   - Entrada por SCORE no 15M
   - SCORE mínimo: 7/12
   - RSI: 40 a 65
   - Volume mínimo: 80% da média
   - Pullback OU breakout
   - Compra MARKET usando 95% do USDT
   - Venda LIMIT em +5%
   - STOP LOSS desativado
   - Uma posição por vez

   IMPORTANTE:
   +5% é um alvo, não uma garantia de lucro.
========================================================= */


/* =========================================================
   CONFIGURAÇÕES
========================================================= */

const INTERVALO = "15m";

const INTERVALO_DIARIO = "1d";

const INTERVALO_4H = "4h";


// TOP 20 por capitalização de mercado
const MAX_MOEDAS = 20;


// TAKE PROFIT
const TAKE_PROFIT = 0.05;


// ENTRADA DE 95% DO SALDO
const PERCENTUAL_ENTRADA = 0.95;


// Estratégia flexibilizada
const RSI_MIN = 40;

const RSI_MAX = 65;

const DISTANCIA_MAX_EMA21 = 0.03;

const VOLUME_MINIMO_MULTIPLO = 0.80;

const SCORE_MINIMO = 7;

const PULLBACK_MAX = 0.03;


// Varredura a cada 15 minutos
const INTERVALO_VARREDURA =
  15 * 60 * 1000;


// Pausa entre moedas
const PAUSA_ENTRE_PARES = 700;


// Cache do ranking CoinGecko
const CACHE_TOP_MS =
  15 * 60 * 1000;

let cacheTop = [];

let cacheTopTimestamp = 0;


// Controle operacional
let operando = false;


/* =========================================================
   BLOQUEIOS
========================================================= */

const BLOQUEADAS = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "DAI",
  "BUSD",
  "USD",
  "USD1",
  "U",
  "UUSDT",
  "RLUSD",
  "EUR",
  "TRY",
  "BRL",
  "GBP",
  "AUD"
]);


const PALAVRAS_BLOQUEADAS = [
  "UP",
  "DOWN",
  "BULL",
  "BEAR"
];


const UM_ANO_MS =
  365 * 24 * 60 * 60 * 1000;


/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

function sleep(ms) {

  return new Promise(
    resolve => setTimeout(resolve, ms)
  );

}


function numero(valor, casas = 8) {

  const n = Number(valor);

  return Number.isFinite(n)
    ? n.toFixed(casas)
    : "0";

}


function erroTexto(err) {

  if (!err) {
    return "Erro desconhecido";
  }

  if (err.body) {

    try {

      return typeof err.body === "string"
        ? err.body
        : JSON.stringify(err.body);

    } catch (_) {

      return String(err.body);

    }

  }

  return err.message || String(err);

}


function ehStable(asset) {

  return BLOQUEADAS.has(
    String(asset || "").toUpperCase()
  );

}


function ehAlavancado(asset) {

  const base =
    String(asset || "").toUpperCase();

  return PALAVRAS_BLOQUEADAS.some(
    palavra => base.endsWith(palavra)
  );

}


/* =========================================================
   EMA
========================================================= */

function ema(values, period) {

  if (
    !Array.isArray(values) ||
    values.length < period
  ) {

    return null;

  }


  const k =
    2 / (period + 1);


  let resultado =
    values
      .slice(0, period)
      .reduce(
        (a, b) => a + b,
        0
      ) / period;


  for (
    let i = period;
    i < values.length;
    i++
  ) {

    resultado =
      values[i] * k +
      resultado * (1 - k);

  }


  return resultado;

}


/* =========================================================
   RSI
========================================================= */

function rsi(values, period = 14) {

  if (
    !Array.isArray(values) ||
    values.length < period + 1
  ) {

    return null;

  }


  let ganhos = 0;

  let perdas = 0;


  const inicio =
    values.length - period;


  for (
    let i = inicio;
    i < values.length;
    i++
  ) {

    const diff =
      values[i] -
      values[i - 1];


    if (diff >= 0) {

      ganhos += diff;

    } else {

      perdas -= diff;

    }

  }


  if (perdas === 0) {

    return 100;

  }


  const rs =
    ganhos / perdas;


  return 100 -
    100 / (1 + rs);

}


/* =========================================================
   AJUSTES BINANCE
========================================================= */

function casasDoStep(step) {

  const texto =
    String(step);


  if (texto.includes("e-")) {

    return Number(
      texto.split("e-")[1]
    );

  }


  const decimal =
    texto.split(".")[1];


  return decimal
    ? decimal.replace(/0+$/, "").length
    : 0;

}


function ajustar(valor, step) {

  if (
    !Number.isFinite(valor) ||
    !Number.isFinite(step) ||
    step <= 0
  ) {

    return 0;

  }


  const casas =
    casasDoStep(step);


  const resultado =
    Math.floor(
      (valor + Number.EPSILON) /
      step
    ) * step;


  return Number(
    resultado.toFixed(casas)
  );

}


function obterFiltro(info, tipo) {

  return info?.filters?.find(
    f => f.filterType === tipo
  );

}


function obterMinNotional(info) {

  const filtro =
    obterFiltro(
      info,
      "NOTIONAL"
    );


  if (filtro?.minNotional) {

    return Number(
      filtro.minNotional
    );

  }


  const antigo =
    obterFiltro(
      info,
      "MIN_NOTIONAL"
    );


  if (antigo?.minNotional) {

    return Number(
      antigo.minNotional
    );

  }


  return 0;

}


/* =========================================================
   TOP 20 MARKET CAP

   A Binance não fornece market cap diretamente.

   CoinGecko fornece o ranking.

   Binance confirma se existe o par USDT.
========================================================= */

async function obterTop20MarketCap(
  exchangeInfo
) {

  const agora =
    Date.now();


  // Utiliza cache
  if (
    cacheTop.length > 0 &&
    agora - cacheTopTimestamp <
      CACHE_TOP_MS
  ) {

    return cacheTop;

  }


  try {

    const resposta =
      await fetch(
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false"
      );


    if (!resposta.ok) {

      throw new Error(
        `CoinGecko HTTP ${resposta.status}`
      );

    }


    const moedas =
      await resposta.json();


    const resultado = [];


    for (
      const moeda of moedas
    ) {

      if (
        resultado.length >=
        MAX_MOEDAS
      ) {

        break;

      }


      const base =
        String(
          moeda.symbol || ""
        ).toUpperCase();


      const nome =
        String(
          moeda.name || ""
        );


      if (!base) {

        continue;

      }


      // Stablecoin
      if (ehStable(base)) {

        continue;

      }


      // Token alavancado
      if (ehAlavancado(base)) {

        continue;

      }


      // Encontrar par USDT na Binance
      const par =
        exchangeInfo.symbols.find(
          s =>
            s.status === "TRADING" &&
            s.quoteAsset === "USDT" &&
            String(
              s.baseAsset || ""
            ).toUpperCase() === base
        );


      if (!par) {

        continue;

      }


      const baseBinance =
        String(
          par.baseAsset || ""
        ).toUpperCase();


      if (
        ehStable(baseBinance)
      ) {

        continue;

      }


      if (
        ehAlavancado(baseBinance)
      ) {

        continue;

      }


      // Bloqueia moeda com menos de 1 ano
      if (
        par.onboardDate &&
        Date.now() -
          Number(par.onboardDate) <
          UM_ANO_MS
      ) {

        continue;

      }


      resultado.push({

        symbol:
          par.symbol,

        baseAsset:
          baseBinance,

        nome,

        rank:
          Number(
            moeda.market_cap_rank ||
            9999
          ),

        marketCap:
          Number(
            moeda.market_cap ||
            0
          )

      });

    }


    cacheTop =
      resultado;


    cacheTopTimestamp =
      agora;


    return resultado;


  } catch (err) {

    console.log(
      "❌ ERRO COINGECKO:",
      erroTexto(err)
    );


    // Se já existe cache, continua funcionando
    if (
      cacheTop.length > 0
    ) {

      console.log(
        "♻️ Usando último TOP 20 armazenado."
      );


      return cacheTop;

    }


    return [];

  }

}


/* =========================================================
   POSIÇÕES E ORDENS
========================================================= */

async function temPosicao(
  symbol
) {

  const asset =
    symbol.replace(
      /USDT$/,
      ""
    );


  const acc =
    await client.accountInfo();


  const saldo =
    Number(
      acc.balances.find(
        b =>
          b.asset === asset
      )?.free || 0
    );


  return saldo > 0;

}


async function temOrdemAberta(
  symbol
) {

  const ordens =
    await client.openOrders({
      symbol
    });


  return ordens.length > 0;

}


/* =========================================================
   VERIFICAR SE EXISTE OPERAÇÃO ATIVA

   O robô trabalha com uma posição por vez.
========================================================= */

async function existeOperacaoAtiva(
  exchangeInfo
) {

  try {

    const ordens =
      await client.openOrders();


    const ordemUSDT =
      ordens.find(
        o =>
          String(
            o.symbol || ""
          ).endsWith("USDT")
      );


    if (ordemUSDT) {

      return {

        ativa: true,

        motivo:
          `Ordem aberta em ${ordemUSDT.symbol}`

      };

    }


    const acc =
      await client.accountInfo();


    for (
      const saldo of acc.balances
    ) {

      const asset =
        String(
          saldo.asset || ""
        ).toUpperCase();


      const quantidade =
        Number(
          saldo.free || 0
        ) +
        Number(
          saldo.locked || 0
        );


      if (
        !asset ||
        asset === "USDT" ||
        quantidade <= 0
      ) {

        continue;

      }


      if (
        ehStable(asset) ||
        ehAlavancado(asset)
      ) {

        continue;

      }


      const possuiParUSDT =
        exchangeInfo.symbols.some(
          s =>
            s.status === "TRADING" &&
            s.quoteAsset === "USDT" &&
            String(
              s.baseAsset || ""
            ).toUpperCase() === asset
        );


      if (
        possuiParUSDT
      ) {

        return {

          ativa: true,

          motivo:
            `Saldo encontrado em ${asset}`

        };

      }

    }


    return {

      ativa: false,

      motivo:
        "Sem operação ativa"

    };


  } catch (err) {

    console.log(
      "⚠️ FALHA AO VERIFICAR POSIÇÃO:",
      erroTexto(err)
    );


    // Segurança:
    // se não conseguimos confirmar,
    // não compramos.
    return {

      ativa: true,

      motivo:
        "Não foi possível confirmar a conta — compra bloqueada"

    };

  }

}


/* =========================================================
   VALIDAR SETUP

   SCORE MÁXIMO = 12

   1D
   +2 preço > EMA50
   +1 EMA50 > EMA200

   4H
   +2 preço > EMA50

   15M
   +2 EMA9 > EMA21
   +1 RSI 40–65
   +1 preço até 3% da EMA21
   +1 volume >= 80% média
   +1 candle positivo
   +1 pullback OU breakout

   MÍNIMO = 7
========================================================= */

async function validarSetup(
  symbol
) {

  try {

    let score = 0;

    const motivos = [];


    /* =====================================================
       1D — TENDÊNCIA PRINCIPAL
    ===================================================== */

    const candles1d =
      await client.candles({

        symbol,

        interval:
          INTERVALO_DIARIO,

        limit: 250

      });


    // Remove candle ainda aberto
    const fechados1d =
      candles1d.slice(0, -1);


    const closes1d =
      fechados1d.map(
        c => Number(c.close)
      );


    if (
      closes1d.length < 200
    ) {

      return {

        valido: false,

        motivo:
          "Poucos candles 1D"

      };

    }


    const ema50_1d =
      ema(
        closes1d,
        50
      );


    const ema200_1d =
      ema(
        closes1d,
        200
      );


    const preco1d =
      closes1d[
        closes1d.length - 1
      ];


    /* PREÇO > EMA50 */

    if (
      preco1d >
      ema50_1d
    ) {

      score += 2;

      motivos.push(
        "1D preço > EMA50 (+2)"
      );

    } else {

      return {

        valido: false,

        motivo:
          "1D preço abaixo da EMA50"

      };

    }


    /* EMA50 > EMA200 */

    if (
      ema50_1d >
      ema200_1d
    ) {

      score += 1;

      motivos.push(
        "1D EMA50 > EMA200 (+1)"
      );

    } else {

      motivos.push(
        "1D EMA50 <= EMA200"
      );

    }


    /* =====================================================
       4H — CONFIRMAÇÃO
    ===================================================== */

    const candles4h =
      await client.candles({

        symbol,

        interval:
          INTERVALO_4H,

        limit: 150

      });


    const fechados4h =
      candles4h.slice(0, -1);


    const closes4h =
      fechados4h.map(
        c => Number(c.close)
      );


    if (
      closes4h.length < 50
    ) {

      return {

        valido: false,

        motivo:
          "Poucos candles 4H"

      };

    }


    const ema50_4h =
      ema(
        closes4h,
        50
      );


    const ema21_4h =
      ema(
        closes4h,
        21
      );


    const preco4h =
      closes4h[
        closes4h.length - 1
      ];


    /* PREÇO > EMA50 */

    if (
      preco4h >
      ema50_4h
    ) {

      score += 2;

      motivos.push(
        "4H preço > EMA50 (+2)"
      );

    } else {

      return {

        valido: false,

        motivo:
          "4H preço abaixo da EMA50"

      };

    }


    if (
      preco4h >
      ema21_4h
    ) {

      motivos.push(
        "4H preço > EMA21"
      );

    }


    /* =====================================================
       15M — ENTRADA
    ===================================================== */

    const candles =
      await client.candles({

        symbol,

        interval:
          INTERVALO,

        limit: 120

      });


    if (
      candles.length < 50
    ) {

      return {

        valido: false,

        motivo:
          "Poucos candles 15M"

      };

    }


    // Apenas candles fechados
    const fechados =
      candles.slice(0, -1);


    const closes =
      fechados.map(
        c => Number(c.close)
      );


    const opens =
      fechados.map(
        c => Number(c.open)
      );


    const highs =
      fechados.map(
        c => Number(c.high)
      );


    const lows =
      fechados.map(
        c => Number(c.low)
      );


    const volumes =
      fechados.map(
        c => Number(c.volume)
      );


    const ema9 =
      ema(
        closes,
        9
      );


    const ema21 =
      ema(
        closes,
        21
      );


    const r =
      rsi(
        closes,
        14
      );


    const ultimo =
      closes.length - 1;


    const precoFechado =
      closes[ultimo];


    const openFechado =
      opens[ultimo];


    const highFechado =
      highs[ultimo];


    const lowFechado =
      lows[ultimo];


    const volumeFechado =
      volumes[ultimo];


    const volumeBase =
      volumes.slice(
        -21,
        -1
      );


    const volumeMedio =
      volumeBase.reduce(
        (a, b) => a + b,
        0
      ) /
      Math.max(
        volumeBase.length,
        1
      );


    /* =====================================================
       EMA9 > EMA21
    ===================================================== */

    if (
      ema9 >
      ema21
    ) {

      score += 2;

      motivos.push(
        "15M EMA9 > EMA21 (+2)"
      );

    } else {

      motivos.push(
        "15M EMA9 <= EMA21"
      );

    }


    /* =====================================================
       RSI
    ===================================================== */

    if (
      r >= RSI_MIN &&
      r <= RSI_MAX
    ) {

      score += 1;

      motivos.push(
        `RSI ${r.toFixed(2)} (+1)`
      );

    } else if (
      r > RSI_MAX &&
      r <= 70
    ) {

      motivos.push(
        `RSI alto, mas aceitável ${r.toFixed(2)}`
      );

    } else {

      motivos.push(
        `RSI fora ${r.toFixed(2)}`
      );

    }


    /* =====================================================
       DISTÂNCIA DA EMA21
    ===================================================== */

    const distanciaEMA21 =
      Math.abs(
        (
          precoFechado -
          ema21
        ) /
        ema21
      );


    if (
      distanciaEMA21 <=
      DISTANCIA_MAX_EMA21
    ) {

      score += 1;

      motivos.push(
        `Preço a ${(distanciaEMA21 * 100).toFixed(2)}% da EMA21 (+1)`
      );

    } else {

      motivos.push(
        `Preço a ${(distanciaEMA21 * 100).toFixed(2)}% da EMA21`
      );

    }


    /* =====================================================
       VOLUME
    ===================================================== */

    if (
      volumeMedio > 0 &&
      volumeFechado >=
        volumeMedio *
        VOLUME_MINIMO_MULTIPLO
    ) {

      score += 1;

      motivos.push(
        `Volume ${(volumeFechado / volumeMedio * 100).toFixed(0)}% da média (+1)`
      );

    } else {

      motivos.push(
        "Volume abaixo de 80% da média"
      );

    }


    /* =====================================================
       CANDLE POSITIVO
    ===================================================== */

    if (
      precoFechado >
      openFechado
    ) {

      score += 1;

      motivos.push(
        "Candle positivo (+1)"
      );

    }


    /* =====================================================
       PULLBACK OU BREAKOUT
    ===================================================== */

    const lowsRecentes =
      lows.slice(-5);


    const menorLow =
      Math.min(
        ...lowsRecentes
      );


    const distanciaLowEMA21 =
      Math.abs(
        (
          menorLow -
          ema21
        ) /
        ema21
      );


    const pullback =
      distanciaLowEMA21 <=
        PULLBACK_MAX &&
      precoFechado >=
        ema21 * 0.995;


    const highsAnteriores =
      highs.slice(
        -11,
        -1
      );


    const maiorHighAnterior =
      Math.max(
        ...highsAnteriores
      );


    const breakout =
      precoFechado >
        maiorHighAnterior &&
      volumeMedio > 0 &&
      volumeFechado >=
        volumeMedio;


    if (
      pullback
    ) {

      score += 1;

      motivos.push(
        "Pullback confirmado (+1)"
      );

    } else if (
      breakout
    ) {

      score += 1;

      motivos.push(
        "Breakout confirmado (+1)"
      );

    } else {

      motivos.push(
        "Sem pullback/breakout"
      );

    }


    /* =====================================================
       PROTEÇÃO CONTRA CANDLE EXAGERADO
    ===================================================== */

    const corpo =
      Math.abs(
        precoFechado -
        openFechado
      );


    const amplitude =
      Math.max(
        highFechado -
        lowFechado,
        0
      );


    if (
      amplitude > 0 &&
      corpo / amplitude > 0.90 &&
      precoFechado >
        ema21 * 1.025
    ) {

      return {

        valido: false,

        motivo:
          "Candle fechado muito esticado"

      };

    }


    /* =====================================================
       SCORE FINAL
    ===================================================== */

    console.log(
      `${symbol} 📊 SCORE ${score}/12 | RSI ${numero(r, 2)}`
    );


    if (
      score <
      SCORE_MINIMO
    ) {

      return {

        valido: false,

        motivo:
          `Score ${score}/12 — mínimo ${SCORE_MINIMO}`

      };

    }


    /* Preço atual real */

    const precoAtual =
      Number(
        (
          await client.prices({
            symbol
          })
        )[symbol]
      );


    if (
      !Number.isFinite(
        precoAtual
      ) ||
      precoAtual <= 0
    ) {

      return {

        valido: false,

        motivo:
          "Preço atual inválido"

      };

    }


    return {

      valido: true,

      precoAtual,

      score,

      rsi: r,

      ema9,

      ema21,

      motivos

    };


  } catch (err) {

    return {

      valido: false,

      motivo:
        erroTexto(err)

    };

  }

}


/* =========================================================
   COMPRA
========================================================= */

async function comprar(
  symbol,
  exchangeInfo
) {

  if (operando) {

    return false;

  }


  try {

    operando = true;


    /* Verificação final */

    const estado =
      await existeOperacaoAtiva(
        exchangeInfo
      );


    if (
      estado.ativa
    ) {

      console.log(
        "⛔ COMPRA BLOQUEADA:",
        estado.motivo
      );

      return false;

    }


    if (
      await temPosicao(
        symbol
      )
    ) {

      console.log(
        symbol,
        "⛔ JÁ POSSUI POSIÇÃO"
      );

      return false;

    }


    if (
      await temOrdemAberta(
        symbol
      )
    ) {

      console.log(
        symbol,
        "⛔ JÁ POSSUI ORDEM ABERTA"
      );

      return false;

    }


    const acc =
      await client.accountInfo();


    const saldoUSDT =
      Number(
        acc.balances.find(
          b =>
            b.asset === "USDT"
        )?.free || 0
      );


    if (
      !Number.isFinite(
        saldoUSDT
      ) ||
      saldoUSDT < 15
    ) {

      console.log(
        "❌ SALDO USDT INSUFICIENTE:",
        saldoUSDT
      );

      return false;

    }


    const precoAtual =
      Number(
        (
          await client.prices({
            symbol
          })
        )[symbol]
      );


    if (
      !Number.isFinite(
        precoAtual
      ) ||
      precoAtual <= 0
    ) {

      throw new Error(
        "Preço atual inválido"
      );

    }


    const info =
      exchangeInfo.symbols.find(
        s =>
          s.symbol ===
          symbol
      );


    if (!info) {

      throw new Error(
        "Informações do símbolo não encontradas"
      );

    }


    const lot =
      obterFiltro(
        info,
        "LOT_SIZE"
      );


    const priceFilter =
      obterFiltro(
        info,
        "PRICE_FILTER"
      );


    const minNotional =
      obterMinNotional(
        info
      );


    if (
      !lot ||
      !priceFilter
    ) {

      throw new Error(
        "LOT_SIZE ou PRICE_FILTER não encontrado"
      );

    }


    const stepSize =
      Number(
        lot.stepSize
      );


    const tickSize =
      Number(
        priceFilter.tickSize
      );


    /* =====================================================
       FÓRMULA DA COMPRA — MANTIDA

       SALDO USDT × 95% ÷ PREÇO
    ===================================================== */

    let quantidadeCompra =
      (
        saldoUSDT *
        PERCENTUAL_ENTRADA
      ) /
      precoAtual;


    quantidadeCompra =
      ajustar(
        quantidadeCompra,
        stepSize
      );


    const valorEstimado =
      quantidadeCompra *
      precoAtual;


    if (
      quantidadeCompra <= 0
    ) {

      throw new Error(
        "Quantidade de compra zerada após ajuste"
      );

    }


    if (
      minNotional > 0 &&
      valorEstimado <
        minNotional
    ) {

      throw new Error(
        `Valor abaixo do mínimo da Binance: ${minNotional} USDT`
      );

    }


    console.log(
      "\n🟢 ================================"
    );


    console.log(
      "🟢 EXECUTANDO COMPRA:",
      symbol
    );


    console.log(
      "💵 SALDO:",
      numero(
        saldoUSDT,
        2
      ),
      "USDT"
    );


    console.log(
      "💰 ENTRADA:",
      `${PERCENTUAL_ENTRADA * 100}%`
    );


    console.log(
      "🪙 QUANTIDADE:",
      quantidadeCompra
    );


    console.log(
      "🟢 ================================"
    );


    /* =====================================================
       ORDEM DE COMPRA — MARKET
    ===================================================== */

    const ordemCompra =
      await client.order({

        symbol,

        side: "BUY",

        type: "MARKET",

        quantity:
          quantidadeCompra

      });


    console.log(
      "✅ COMPRA EXECUTADA. ORDER ID:",
      ordemCompra.orderId
    );


    await sleep(3000);


    const asset =
      symbol.replace(
        /USDT$/,
        ""
      );


    const accAtualizado =
      await client.accountInfo();


    let quantidadeReal =
      Number(
        accAtualizado.balances.find(
          b =>
            b.asset ===
            asset
        )?.free || 0
      );


    quantidadeReal =
      ajustar(
        quantidadeReal,
        stepSize
      );


    if (
      quantidadeReal <= 0
    ) {

      throw new Error(
        `Saldo de ${asset} não encontrado após a compra`
      );

    }


    /* =====================================================
       PREÇO MÉDIO REAL DA COMPRA
    ===================================================== */

    let precoEntrada =
      precoAtual;


    if (
      Array.isArray(
        ordemCompra.fills
      ) &&
      ordemCompra.fills.length > 0
    ) {

      let quantidadeTotal = 0;

      let valorTotal = 0;


      for (
        const fill of
        ordemCompra.fills
      ) {

        const quantidade =
          Number(
            fill.qty || 0
          );


        const preco =
          Number(
            fill.price || 0
          );


        quantidadeTotal +=
          quantidade;


        valorTotal +=
          quantidade *
          preco;

      }


      if (
        quantidadeTotal > 0
      ) {

        precoEntrada =
          valorTotal /
          quantidadeTotal;

      }

    }


    if (
      !Number.isFinite(
        precoEntrada
      ) ||
      precoEntrada <= 0
    ) {

      precoEntrada =
        Number(
          (
            await client.prices({
              symbol
            })
          )[symbol]
        );

    }


    /* =====================================================
       TAKE PROFIT +5%
    ===================================================== */

    let precoVenda =
      precoEntrada *
      (1 + TAKE_PROFIT);


    precoVenda =
      ajustar(
        precoVenda,
        tickSize
      );


    const valorVenda =
      quantidadeReal *
      precoVenda;


    if (
      minNotional > 0 &&
      valorVenda <
        minNotional
    ) {

      throw new Error(
        `Venda abaixo do mínimo da Binance: ${minNotional} USDT`
      );

    }


    console.log(
      "🎯 PREÇO MÉDIO ENTRADA:",
      precoEntrada
    );


    console.log(
      "🎯 TAKE PROFIT:",
      precoVenda
    );


    console.log(
      "🛑 STOP LOSS: DESATIVADO"
    );


    /* =====================================================
       ORDEM DE VENDA — LIMIT +5%
    ===================================================== */

    const ordemVenda =
      await client.order({

        symbol,

        side: "SELL",

        type: "LIMIT",

        quantity:
          quantidadeReal,

        price:
          precoVenda,

        timeInForce:
          "GTC"

      });


    console.log(
      "✅ ORDEM DE VENDA CRIADA. ORDER ID:",
      ordemVenda.orderId
    );


    console.log(
      `🎯 ALVO DA OPERAÇÃO: +${TAKE_PROFIT * 100}%`
    );


    return true;


  } catch (err) {

    console.log(
      "❌ ERRO NA COMPRA:",
      erroTexto(err)
    );


    return false;


  } finally {

    operando = false;

  }

}
