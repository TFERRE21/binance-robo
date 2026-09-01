require("dotenv").config();

const Binance = require("binance-api-node").default;

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET
});

/* =========================================================
   CONFIGURAÇÕES
========================================================= */

// Timeframe principal de entrada
const INTERVALO = "15m";

// Tendência principal
const INTERVALO_DIARIO = "1d";

// Confirmação intermediária
const INTERVALO_4H = "4h";

// TOP 20 por capitalização de mercado
const MAX_MOEDAS = 20;

// TAKE PROFIT = 5%
const TAKE_PROFIT = 0.05;

// ENTRADA = 95% DO SALDO
const PERCENTUAL_ENTRADA = 0.95;

// RSI
const RSI_MIN = 45;
const RSI_MAX = 58;

// Distância máxima da EMA21 no momento da entrada
const DISTANCIA_MAX_EMA21 = 0.01;

// Pontuação mínima
const SCORE_MINIMO = 9;

// Tempo entre verificações
const TEMPO_MONITORAMENTO = 15000;

// Tempo máximo monitorando uma oportunidade
const TEMPO_MAXIMO_ESPERA = 2 * 60 * 60 * 1000;

// Nova varredura a cada 15 minutos
const INTERVALO_VARREDURA = 15 * 60 * 1000;

// Uma operação por vez
let operando = false;

// Moedas sendo monitoradas
const monitorando = new Set();

/* =========================================================
   BLOQUEIOS
========================================================= */

const BLOQUEADAS = [
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
];

const PALAVRAS_BLOQUEADAS = [
  "BULL",
  "BEAR",
  "UP",
  "DOWN"
];

// Não aceitar moedas listadas há menos de 1 ano
const UM_ANO_MS =
  365 * 24 * 60 * 60 * 1000;

/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* =========================================================
   EMA
========================================================= */

function ema(values, period) {

  if (!values || values.length < period) {
    return null;
  }

  const k = 2 / (period + 1);

  let e = values[0];

  for (let i = 1; i < values.length; i++) {

    e =
      values[i] * k +
      e * (1 - k);
  }

  return e;
}

/* =========================================================
   RSI
========================================================= */

function rsi(values, period = 14) {

  if (!values || values.length < period + 1) {
    return null;
  }

  let ganhos = 0;
  let perdas = 0;

  for (
    let i = values.length - period;
    i < values.length;
    i++
  ) {

    const diff =
      values[i] - values[i - 1];

    if (diff >= 0) {

      ganhos += diff;

    } else {

      perdas -= diff;
    }
  }

  if (perdas === 0) {
    return 100;
  }

  const rs = ganhos / perdas;

  return 100 - (100 / (1 + rs));
}

/* =========================================================
   AJUSTAR QUANTIDADE / PREÇO
========================================================= */

function ajustar(valor, step) {

  const precision =
    Math.round(-Math.log10(step));

  return parseFloat(
    (
      Math.floor(valor / step) * step
    ).toFixed(precision)
  );
}

/* =========================================================
   OBTER TOP 20 MARKET CAP
========================================================= */

/*
   A Binance não fornece capitalização de mercado diretamente
   em dailyStats().

   Por isso usamos CoinGecko para identificar as maiores moedas
   por market cap e depois procuramos o respectivo par USDT
   disponível na Binance.
*/

async function obterTop20MarketCap(exchangeInfo) {

  try {

    const resposta = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false"
    );

    if (!resposta.ok) {

      throw new Error(
        `CoinGecko HTTP ${resposta.status}`
      );
    }

    const moedas = await resposta.json();

    const resultado = [];

    for (const moeda of moedas) {

      if (resultado.length >= MAX_MOEDAS) {
        break;
      }

      const simboloBase =
        String(moeda.symbol || "")
          .toUpperCase();

      const nomeBase =
        String(moeda.name || "");

      if (!simboloBase) {
        continue;
      }

      /* =========================
         BLOQUEAR STABLECOINS
      ========================= */

      if (
        BLOQUEADAS.some(
          bloqueada =>
            simboloBase.includes(bloqueada)
        )
      ) {

        console.log(
          simboloBase,
          "⛔ STABLE BLOQUEADA"
        );

        continue;
      }

      /* =========================
         BLOQUEAR ALAVANCADAS
      ========================= */

      if (
        PALAVRAS_BLOQUEADAS.some(
          palavra =>
            simboloBase.includes(palavra)
        )
      ) {

        continue;
      }

      /*
         Procurar o par USDT correspondente
         na Binance.
      */

      const simboloBinance =
        exchangeInfo.symbols.find(
          s =>
            s.status === "TRADING" &&
            s.quoteAsset === "USDT" &&
            s.baseAsset.toUpperCase() === simboloBase
        );

      if (!simboloBinance) {
        continue;
      }

      const base =
        simboloBinance.baseAsset.toUpperCase();

      /* =========================
         BLOQUEIO STABLE
      ========================= */

      if (
        BLOQUEADAS.some(
          b => base.includes(b)
        )
      ) {

        console.log(
          simboloBinance.symbol,
          "⛔ STABLE BLOQUEADA"
        );

        continue;
      }

      /* =========================
         BLOQUEIO LEVERAGED
      ========================= */

      if (
        PALAVRAS_BLOQUEADAS.some(
          p => base.includes(p)
        )
      ) {

        console.log(
          simboloBinance.symbol,
          "⛔ LEVERAGED"
        );

        continue;
      }

      /* =========================
         BLOQUEIO NOME ESTRANHO
      ========================= */

      if (
        /[^a-zA-Z0-9]/.test(base)
      ) {

        continue;
      }

      /* =========================
         BLOQUEIO MOEDA NOVA
      ========================= */

      if (simboloBinance.onboardDate) {

        if (
          Date.now() -
          simboloBinance.onboardDate <
          UM_ANO_MS
        ) {

          console.log(
            simboloBinance.symbol,
            "⛔ MOEDA COM MENOS DE 1 ANO"
          );

          continue;
        }
      }

      resultado.push({
        symbol: simboloBinance.symbol,
        marketCap: moeda.market_cap,
        rank: moeda.market_cap_rank,
        nome: nomeBase
      });
    }

    return resultado;

  } catch (err) {

    console.log(
      "❌ Erro ao obter TOP 20 Market Cap:",
      err.message
    );

    return [];
  }
}

/* =========================================================
   VERIFICAR POSIÇÃO
========================================================= */

async function temPosicao(symbol) {

  const asset =
    symbol.replace("USDT", "");

  const acc =
    await client.accountInfo();

  const saldo =
    parseFloat(
      acc.balances.find(
        b => b.asset === asset
      )?.free || 0
    );

  return saldo > 0;
}

/* =========================================================
   VERIFICAR ORDENS ABERTAS
========================================================= */

async function temOrdemAberta(symbol) {

  const ordens =
    await client.openOrders({
      symbol
    });

  return ordens.length > 0;
}

/* =========================================================
   VALIDAR SETUP
========================================================= */

async function validarSetup(symbol) {

  try {

    let score = 0;

    const motivos = [];

    /* =====================================================
       TENDÊNCIA DIÁRIA
    ===================================================== */

    const candles1d =
      await client.candles({
        symbol,
        interval: INTERVALO_DIARIO,
        limit: 250
      });

    const closes1d =
      candles1d.map(
        c => parseFloat(c.close)
      );

    if (closes1d.length < 200) {

      return {
        valido: false,
        motivo: "Poucos candles 1D"
      };
    }

    const ema50_1d =
      ema(
        closes1d.slice(-50),
        50
      );

    const ema200_1d =
      ema(
        closes1d.slice(-200),
        200
      );

    const preco1d =
      closes1d[
        closes1d.length - 1
      ];

    /* =========================
       PREÇO > EMA50
    ========================= */

    if (preco1d > ema50_1d) {

      score += 2;

      motivos.push(
        "Preço acima EMA50 1D"
      );

    } else {

      return {
        valido: false,
        motivo: "Preço abaixo EMA50 1D"
      };
    }

    /* =========================
       EMA50 > EMA200
    ========================= */

    if (ema50_1d > ema200_1d) {

      score += 2;

      motivos.push(
        "EMA50 > EMA200"
      );

    } else {

      return {
        valido: false,
        motivo: "Tendência 1D não confirmada"
      };
    }

    /* =====================================================
       TENDÊNCIA 4H
    ===================================================== */

    const candles4h =
      await client.candles({
        symbol,
        interval: INTERVALO_4H,
        limit: 100
      });

    const closes4h =
      candles4h.map(
        c => parseFloat(c.close)
      );

    const ema21_4h =
      ema(
        closes4h.slice(-21),
        21
      );

    const preco4h =
      closes4h[
        closes4h.length - 1
      ];

    if (preco4h > ema21_4h) {

      score += 2;

      motivos.push(
        "Preço acima EMA21 4H"
      );

    } else {

      return {
        valido: false,
        motivo: "Tendência 4H fraca"
      };
    }

    /* =====================================================
       ENTRADA 15M
    ===================================================== */

    const candles =
      await client.candles({
        symbol,
        interval: INTERVALO,
        limit: 100
      });

    const closes =
      candles.map(
        c => parseFloat(c.close)
      );

    const opens =
      candles.map(
        c => parseFloat(c.open)
      );

    const highs =
      candles.map(
        c => parseFloat(c.high)
      );

    const lows =
      candles.map(
        c => parseFloat(c.low)
      );

    const volumes =
      candles.map(
        c => parseFloat(c.volume)
      );

    const ema9 =
      ema(
        closes.slice(-9),
        9
      );

    const ema21 =
      ema(
        closes.slice(-21),
        21
      );

    const r =
      rsi(closes, 14);

    const precoAtual =
      closes[closes.length - 1];

    const openAtual =
      opens[opens.length - 1];

    const highAtual =
      highs[highs.length - 1];

    const lowAtual =
      lows[lows.length - 1];

    const volumeAtual =
      volumes[volumes.length - 1];

    const volumeMedio =
      volumes
        .slice(-20)
        .reduce(
          (a, b) => a + b,
          0
        ) / 20;

    /* =====================================================
       EMA9 > EMA21
    ===================================================== */

    if (ema9 > ema21) {

      score += 2;

      motivos.push(
        "EMA9 > EMA21"
      );

    } else {

      return {
        valido: false,
        motivo: "EMA9 abaixo EMA21"
      };
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
        `RSI saudável: ${r.toFixed(2)}`
      );

    } else {

      return {
        valido: false,
        motivo:
          `RSI fora da faixa: ${r.toFixed(2)}`
      };
    }

    /* =====================================================
       PREÇO NÃO MUITO LONGE DA EMA21
    ===================================================== */

    const distanciaEMA21 =
      Math.abs(
        (
          precoAtual -
          ema21
        ) / ema21
      );

    if (
      distanciaEMA21 <=
      DISTANCIA_MAX_EMA21
    ) {

      score += 1;

      motivos.push(
        "Preço próximo da EMA21"
      );

    } else {

      return {
        valido: false,
        motivo: "Preço muito distante EMA21"
      };
    }

    /* =====================================================
       CANDLE POSITIVO
    ===================================================== */

    const candlePositivo =
      precoAtual > openAtual;

    if (candlePositivo) {

      score += 1;

      motivos.push(
        "Candle positivo"
      );

    } else {

      return {
        valido: false,
        motivo: "Candle negativo"
      };
    }

    /* =====================================================
       VOLUME
    ===================================================== */

    if (
      volumeAtual >
      volumeMedio
    ) {

      score += 1;

      motivos.push(
        "Volume acima da média"
      );

    } else {

      return {
        valido: false,
        motivo: "Volume fraco"
      };
    }

    /* =====================================================
       PULLBACK
    ===================================================== */

    /*
       Verifica se a mínima recente chegou próxima
       da EMA21, indicando correção/pullback.
    */

    const menorLowRecentes =
      Math.min(
        ...lows.slice(-5)
      );

    const distanciaPullback =
      Math.abs(
        (
          menorLowRecentes -
          ema21
        ) / ema21
      );

    if (
      distanciaPullback <= 0.01
    ) {

      score += 1;

      motivos.push(
        "Pullback confirmado"
      );

    } else {

      return {
        valido: false,
        motivo: "Sem pullback próximo da EMA21"
      };
    }

    /* =====================================================
       RESULTADO
    ===================================================== */

    console.log(
      symbol,
      `📊 SCORE: ${score}/${12}`
    );

    if (
      score < SCORE_MINIMO
    ) {

      return {
        valido: false,
        motivo:
          `Score insuficiente: ${score}/${SCORE_MINIMO}`
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
      motivo: err.message
    };
  }
}

/* =========================================================
   COMPRA
========================================================= */

async function comprar(symbol) {

  if (operando) {
    return;
  }

  if (
    await temPosicao(symbol)
  ) {
    console.log(
      symbol,
      "⛔ JÁ POSSUI POSIÇÃO"
    );

    return;
  }

  if (
    await temOrdemAberta(symbol)
  ) {
    console.log(
      symbol,
      "⛔ JÁ POSSUI ORDEM ABERTA"
    );

    return;
  }

  try {

    operando = true;

    const acc =
      await client.accountInfo();

    const saldoUSDT =
      parseFloat(
        acc.balances.find(
          b => b.asset === "USDT"
        )?.free || 0
      );

    if (saldoUSDT < 15) {

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

    const exchangeInfo =
      await client.exchangeInfo();

    const info =
      exchangeInfo.symbols.find(
        s =>
          s.symbol === symbol
      );

    if (!info) {

      throw new Error(
        "Informações do símbolo não encontradas."
      );
    }

    const lot =
      info.filters.find(
        f =>
          f.filterType ===
          "LOT_SIZE"
      );

    const priceFilter =
      info.filters.find(
        f =>
          f.filterType ===
          "PRICE_FILTER"
      );

    const stepSize =
      parseFloat(
        lot.stepSize
      );

    const tickSize =
      parseFloat(
        priceFilter.tickSize
      );

    /*
       =====================================================
       NÃO ALTERAR ESTA FÓRMULA
       =====================================================
    */

    let quantidadeCompra =
      (
        saldoUSDT *
        PERCENTUAL_ENTRADA
      ) / precoAtual;

    quantidadeCompra =
      ajustar(
        quantidadeCompra,
        stepSize
      );

    console.log(
      "🟢 COMPRANDO",
      symbol
    );

    console.log(
      "💵 SALDO USDT:",
      saldoUSDT
    );

    console.log(
      "📊 ENTRADA:",
      `${PERCENTUAL_ENTRADA * 100}%`
    );

    console.log(
      "🪙 QUANTIDADE:",
      quantidadeCompra
    );

    /*
       =====================================================
       NÃO ALTERAR ESTA ORDEM
       =====================================================
    */

    await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidadeCompra
    });

    await sleep(3000);

    const asset =
      symbol.replace(
        "USDT",
        ""
      );

    const accAtualizado =
      await client.accountInfo();

    let quantidadeReal =
      parseFloat(
        accAtualizado.balances.find(
          b =>
            b.asset === asset
        )?.free || 0
      );

    quantidadeReal =
      ajustar(
        quantidadeReal,
        stepSize
      );

    /*
       =====================================================
       PREÇO DE ENTRADA
       =====================================================
    */

    const precoEntrada =
      parseFloat(
        (
          await client.prices({
            symbol
          })
        )[symbol]
      );

    /*
       =====================================================
       TAKE PROFIT 5%
       =====================================================
    */

    let precoVenda =
      precoEntrada *
      (1 + TAKE_PROFIT);

    precoVenda =
      ajustar(
        precoVenda,
        tickSize
      );

    console.log(
      "🎯 VENDA EM:",
      precoVenda
    );

    /*
       =====================================================
       NÃO ALTERAR ESTA ORDEM
       =====================================================
    */

    await client.order({
      symbol,
      side: "SELL",
      type: "LIMIT",
      quantity: quantidadeReal,
      price: precoVenda,
      timeInForce: "GTC"
    });

    console.log(
      "✅ ORDEM DE VENDA CRIADA"
    );

    console.log(
      `🎯 TAKE PROFIT: +${TAKE_PROFIT * 100}%`
    );

  } catch (err) {

    console.log(
      "❌ Erro:",
      err.body ||
      err.message
    );

  } finally {

    operando = false;
  }
}

/* =========================================================
   MONITORAMENTO DE PULLBACK
========================================================= */

async function monitorarQueda(
  symbol,
  precoReferencia
) {

  if (
    monitorando.has(symbol)
  ) {
    return;
  }

  monitorando.add(symbol);

  /*
     Mantemos a lógica de esperar uma correção de 3%.
     Porém, antes de comprar, o setup completo é
     revalidado novamente.
  */

  const precoAlvo =
    precoReferencia *
    (1 - 0.03);

  console.log(
    "\n👀 MONITORANDO",
    symbol
  );

  console.log(
    "🎯 PREÇO DE REFERÊNCIA:",
    precoReferencia
  );

  console.log(
    "🎯 PREÇO DE PULLBACK:",
    precoAlvo
  );

  const inicio =
    Date.now();

  while (true) {

    try {

      if (operando) {

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
        "💰 Atual:",
        precoAtual
      );

      /*
         Se atingir a correção de 3%,
         fazemos uma nova validação.
      */

      if (
        precoAtual <=
        precoAlvo
      ) {

        console.log(
          symbol,
          "📉 CORREÇÃO DE 3% ATINGIDA"
        );

        console.log(
          symbol,
          "🔎 REVALIDANDO SETUP..."
        );

        const revalidacao =
          await validarSetup(
            symbol
          );

        if (
          revalidacao.valido
        ) {

          console.log(
            symbol,
            "✅ SETUP CONTINUA VÁLIDO"
          );

          console.log(
            symbol,
            "📊 SCORE:",
            revalidacao.score
          );

          await comprar(
            symbol
          );

        } else {

          console.log(
            symbol,
            "❌ SETUP INVALIDADO:",
            revalidacao.motivo
          );
        }

        monitorando.delete(
          symbol
        );

        return;
      }

      /*
         Tempo máximo
      */

      const tempoDecorrido =
        Date.now() -
        inicio;

      if (
        tempoDecorrido >=
        TEMPO_MAXIMO_ESPERA
      ) {

        console.log(
          symbol,
          "⌛ TEMPO MÁXIMO ATINGIDO"
        );

        monitorando.delete(
          symbol
        );

        return;
      }

      await sleep(
        TEMPO_MONITORAMENTO
      );

    } catch (err) {

      console.log(
        "❌ Erro monitoramento:",
        err.message
      );

      monitorando.delete(
        symbol
      );

      return;
    }
  }
}

/* =========================================================
   ROBÔ PRINCIPAL
========================================================= */

async function iniciar() {

  while (true) {

    try {

      console.log(
        "\n========================================"
      );

      console.log(
        "🔎 NOVA VARREDURA TOP 20 MARKET CAP"
      );

      console.log(
        "========================================\n"
      );

      /*
         =====================================================
         INFORMAÇÕES DA BINANCE
         =====================================================
      */

      const exchangeInfo =
        await client.exchangeInfo();

      /*
         =====================================================
         TOP 20 MARKET CAP
         =====================================================
      */

      const pares =
        await obterTop20MarketCap(
          exchangeInfo
        );

      if (
        pares.length === 0
      ) {

        console.log(
          "❌ Não foi possível obter o TOP 20."
        );

        await sleep(
          INTERVALO_VARREDURA
        );

        continue;
      }

      console.log(
        "\n📊 TOP 20 MARKET CAP:\n"
      );

      pares.forEach(
        (par, index) => {

          console.log(
            `${index + 1}. ${par.symbol} | Rank #${par.rank}`
          );
        }
      );

      /*
         =====================================================
         ANALISAR CADA MOEDA
         =====================================================
      */

      for (
        const par of pares
      ) {

        console.log(
          "\n➡️ ANALISANDO:",
          par.symbol
        );

        /*
           Se já está monitorando,
           não cria outro monitoramento.
        */

        if (
          monitorando.has(
            par.symbol
          )
        ) {

          console.log(
            par.symbol,
            "👀 JÁ MONITORANDO"
          );

          continue;
        }

        /*
           Se já existe operação,
           não procura outra.
        */

        if (operando) {

          console.log(
            "⏸️ OPERAÇÃO EM ANDAMENTO"
          );

          break;
        }

        /*
           Validar setup
        */

        const setup =
          await validarSetup(
            par.symbol
          );

        if (
          !setup.valido
        ) {

          console.log(
            par.symbol,
            "❌",
            setup.motivo
          );

          continue;
        }

        /*
           Setup aprovado
        */

        console.log(
          par.symbol,
          "✅ SETUP CONFIRMADO"
        );

        console.log(
          par.symbol,
          "📊 SCORE:",
          setup.score
        );

        console.log(
          par.symbol,
          "📈 RSI:",
          setup.rsi.toFixed(2)
        );

        /*
           Mostrar motivos
        */

        console.log(
          par.symbol,
          "📝",
          setup.motivos.join(
            " | "
          )
        );

        /*
           Iniciar monitoramento
        */

        console.log(
          par.symbol,
          "👀 INICIANDO MONITORAMENTO"
        );

        monitorarQueda(
          par.symbol,
          setup.precoAtual
        );
      }

    } catch (err) {

      console.log(
        "\n❌ ERRO PRINCIPAL:",
        err.body ||
        err.message
      );
    }

    console.log(
      "\n⏳ NOVA VARREDURA EM 15 MINUTOS...\n"
    );

    await sleep(
      INTERVALO_VARREDURA
    );
  }
}

/* =========================================================
   INICIAR
========================================================= */

console.log(
  "🔥 ROBÔ TOP 20 MARKET CAP ATIVO"
);

console.log(
  "🎯 TAKE PROFIT: +5%"
);

console.log(
  "💰 ENTRADA: 95%"
);

console.log(
  "🛑 STOP LOSS: DESATIVADO"
);

console.log(
  "🇩🇪 EXECUÇÃO: FRANKFURT"
);

iniciar();
