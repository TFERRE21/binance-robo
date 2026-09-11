require("dotenv").config();
const Binance = require("binance-api-node").default;

const CONTAS = [
  {
    id: 1,
    nome: "SUA CONTA",
    apiKey: process.env.API_KEY_1,
    apiSecret: process.env.API_SECRET_1
  },
  {
    id: 2,
    nome: "CONTA DO AMIGO",
    apiKey: process.env.API_KEY_2,
    apiSecret: process.env.API_SECRET_2
  }
].map(conta => ({
  ...conta,
  client: Binance({
    apiKey: conta.apiKey,
    apiSecret: conta.apiSecret
  }),
  estado: {
    operando: false,
    ultimaVenda: 0,
    ultimaMoedaOperada: null,
    horarioUltimaOperacaoMoeda: 0
  }
}));


/* =========================================================
   CONFIGURAÇÕES PRINCIPAIS
========================================================= */

const INTERVALO_ENTRADA = "15m";

const INTERVALO_4H = "4h";

const INTERVALO_1D = "1d";

const MAX_MOEDAS = 20;


/* =========================================================
   OPERAÇÃO
========================================================= */

const TAKE_PROFIT = 0.05;

const PERCENTUAL_ENTRADA = 0.98;

const STOP_LOSS_ATIVO = false;


/* =========================================================
   FILTRO DE ENTRADA
========================================================= */

const RSI_MIN = 40;

const RSI_MAX = 65;

const DISTANCIA_MAXIMA_ENTRADA = 0.04;

const DISTANCIA_PULLBACK = 0.025;

const VOLUME_MINIMO = 0.80;

const VOLUME_BREAKOUT = 1.30;

const SCORE_MINIMO = 7;


/* =========================================================
   FILTRO DO MERCADO
========================================================= */

const SCORE_MERCADO_MINIMO = 2;

const MERCADO_ESTICADO = 0.04;

const RSI_MERCADO_QUENTE = 70;


/* =========================================================
   TEMPOS
========================================================= */

const INTERVALO_VARREDURA =
  15 * 60 * 1000;

const PAUSA_ENTRE_MOEDAS =
  1000;

const COOLDOWN_GERAL =
  30 * 60 * 1000;

const COOLDOWN_MESMA_MOEDA =
  2 * 60 * 60 * 1000;

const CACHE_MARKET_CAP =
  15 * 60 * 1000;


/* =========================================================
   DUST
========================================================= */

const VALOR_MINIMO_POSICAO = 5;


/* =========================================================
   CACHE
========================================================= */

let cacheMarketCap = [];

let ultimaAtualizacaoMarketCap = 0;


/* =========================================================
   BLOQUEIOS
========================================================= */

const STABLECOINS = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "DAI",
  "BUSD",
  "USD",
  "USD1",
  "RLUSD",
  "EUR",
  "TRY",
  "BRL",
  "GBP",
  "AUD"
]);


const SUFIXOS_ALAVANCADOS = [
  "UP",
  "DOWN",
  "BULL",
  "BEAR"
];


/* =========================================================
   FUNÇÕES BÁSICAS
========================================================= */

function sleep(ms) {

  return new Promise(
    resolve => setTimeout(resolve, ms)
  );

}


/* =========================================================
   ERROS
========================================================= */

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


/* =========================================================
   STABLECOIN
========================================================= */

function ehStablecoin(asset) {

  return STABLECOINS.has(
    String(asset || "").toUpperCase()
  );

}


/* =========================================================
   ALAVANCADA
========================================================= */

function ehAlavancada(asset) {

  const nome =
    String(asset || "").toUpperCase();

  return SUFIXOS_ALAVANCADOS.some(
    sufixo =>
      nome.endsWith(sufixo)
  );

}


/* =========================================================
   EMA
========================================================= */

function calcularEMA(
  valores,
  periodo
) {

  if (
    !Array.isArray(valores) ||
    valores.length < periodo
  ) {

    return null;

  }

  let mediaInicial = 0;

  for (
    let i = 0;
    i < periodo;
    i++
  ) {

    mediaInicial +=
      Number(valores[i]);

  }

  mediaInicial /= periodo;

  const multiplicador =
    2 / (periodo + 1);

  let resultado =
    mediaInicial;

  for (
    let i = periodo;
    i < valores.length;
    i++
  ) {

    resultado =
      (
        Number(valores[i]) -
        resultado
      ) *
      multiplicador +
      resultado;

  }

  return resultado;

}


/* =========================================================
   RSI
========================================================= */

function calcularRSI(
  valores,
  periodo = 14
) {

  if (
    !Array.isArray(valores) ||
    valores.length < periodo + 1
  ) {

    return null;

  }

  let ganhos = 0;

  let perdas = 0;

  const inicio =
    valores.length - periodo;

  for (
    let i = inicio;
    i < valores.length;
    i++
  ) {

    const diferenca =
      Number(valores[i]) -
      Number(valores[i - 1]);

    if (diferenca > 0) {

      ganhos += diferenca;

    } else {

      perdas +=
        Math.abs(diferenca);

    }

  }

  if (perdas === 0) {

    return 100;

  }

  const rs =
    ganhos / perdas;

  return (
    100 -
    100 / (1 + rs)
  );

}


/* =========================================================
   CASAS DECIMAIS
========================================================= */

function casasDecimais(valor) {

  const texto =
    String(valor);

  if (
    texto.includes("e-")
  ) {

    return Number(
      texto.split("e-")[1]
    );

  }

  if (
    !texto.includes(".")
  ) {

    return 0;

  }

  return texto
    .split(".")[1]
    .replace(/0+$/, "")
    .length;

}


/* =========================================================
   AJUSTAR QUANTIDADE
========================================================= */

function ajustarQuantidade(
  valor,
  step
) {

  if (
    !Number.isFinite(valor) ||
    !Number.isFinite(step) ||
    step <= 0
  ) {

    return 0;

  }

  const casas =
    casasDecimais(step);

  return Number(
    (
      Math.floor(valor / step) *
      step
    ).toFixed(casas)
  );

}


/* =========================================================
   AJUSTAR PREÇO
========================================================= */

function ajustarPreco(
  valor,
  tick
) {

  if (
    !Number.isFinite(valor) ||
    !Number.isFinite(tick) ||
    tick <= 0
  ) {

    return 0;

  }

  const casas =
    casasDecimais(tick);

  return Number(
    (
      Math.floor(valor / tick) *
      tick
    ).toFixed(casas)
  );

}


/* =========================================================
   FILTRO BINANCE
========================================================= */

function encontrarFiltro(
  info,
  tipo
) {

  return info?.filters?.find(
    filtro =>
      filtro.filterType === tipo
  );

}


/* =========================================================
   MIN NOTIONAL
========================================================= */

function obterMinimoNotional(info) {

  const notional =
    encontrarFiltro(
      info,
      "NOTIONAL"
    );

  if (
    notional?.minNotional
  ) {

    return Number(
      notional.minNotional
    );

  }

  const antigo =
    encontrarFiltro(
      info,
      "MIN_NOTIONAL"
    );

  return antigo?.minNotional
    ? Number(antigo.minNotional)
    : 0;

}


/* =========================================================
   TOP 20 MARKET CAP
========================================================= */

async function obterTop20MarketCap(
  exchangeInfo
) {

  const agora =
    Date.now();

  if (
    cacheMarketCap.length &&
    agora -
      ultimaAtualizacaoMarketCap <
      CACHE_MARKET_CAP
  ) {

    return cacheMarketCap;

  }

  try {

    console.log(
      "🌎 ATUALIZANDO TOP 20 MARKET CAP..."
    );

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

      const simbolo =
        String(
          moeda.symbol || ""
        ).toUpperCase();

      const nome =
        String(
          moeda.name || ""
        );

      if (
        !simbolo ||
        ehStablecoin(simbolo) ||
        ehAlavancada(simbolo)
      ) {

        continue;

      }

      const par =
        exchangeInfo.symbols.find(
          item =>
            item.status ===
              "TRADING" &&
            item.quoteAsset ===
              "USDT" &&
            String(
              item.baseAsset
            ).toUpperCase() ===
              simbolo
        );

      if (!par) {

        continue;

      }

      const base =
        String(
          par.baseAsset
        ).toUpperCase();

      if (
        ehStablecoin(base) ||
        ehAlavancada(base)
      ) {

        continue;

      }

      if (
        par.onboardDate &&
        Date.now() -
          Number(par.onboardDate) <
          365 *
          24 *
          60 *
          60 *
          1000
      ) {

        console.log(
          `${par.symbol} ⛔ MOEDA NOVA`
        );

        continue;

      }

      resultado.push({

        symbol:
          par.symbol,

        baseAsset:
          base,

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

    cacheMarketCap =
      resultado;

    ultimaAtualizacaoMarketCap =
      agora;

    console.log(
      `✅ TOP ${resultado.length} ATIVOS ATUALIZADO`
    );

    return resultado;

  } catch (err) {

    console.log(
      "❌ ERRO MARKET CAP:",
      erroTexto(err)
    );

    if (
      cacheMarketCap.length
    ) {

      console.log(
        "♻️ USANDO TOP 20 ANTERIOR"
      );

      return cacheMarketCap;

    }

    return [];

  }

}


/* =========================================================
   AVALIAR MERCADO
========================================================= */

async function avaliarMercado(client) {

  try {

    const candles1D =
      await client.candles({

        symbol:
          "BTCUSDT",

        interval:
          INTERVALO_1D,

        limit:
          250

      });

    const closes1D =
      candles1D
        .slice(0, -1)
        .map(
          c => Number(c.close)
        );

    if (
      closes1D.length < 200
    ) {

      return {

        favoravel: false,
        quente: false,
        score: 0,
        motivo:
          "Poucos candles BTC 1D"

      };

    }

    const ema50_1D =
      calcularEMA(
        closes1D,
        50
      );

    const ema200_1D =
      calcularEMA(
        closes1D,
        200
      );

    const preco1D =
      closes1D.at(-1);

    let score = 0;

    const motivos = [];

    if (
      preco1D >
      ema50_1D
    ) {

      score++;

      motivos.push(
        "BTC 1D > EMA50"
      );

    } else {

      motivos.push(
        "BTC 1D < EMA50"
      );

    }

    if (
      ema50_1D >
      ema200_1D
    ) {

      score++;

      motivos.push(
        "BTC EMA50 > EMA200"
      );

    } else {

      motivos.push(
        "BTC EMA50 <= EMA200"
      );

    }

    const candles4H =
      await client.candles({

        symbol:
          "BTCUSDT",

        interval:
          INTERVALO_4H,

        limit:
          150

      });

    const closes4H =
      candles4H
        .slice(0, -1)
        .map(
          c => Number(c.close)
        );

    if (
      closes4H.length < 50
    ) {

      return {

        favoravel: false,
        quente: false,
        score,
        motivo:
          "Poucos candles BTC 4H"

      };

    }

    const ema21_4H =
      calcularEMA(
        closes4H,
        21
      );

    const ema50_4H =
      calcularEMA(
        closes4H,
        50
      );

    const rsi4H =
      calcularRSI(
        closes4H,
        14
      );

    const preco4H =
      closes4H.at(-1);

    if (
      preco4H >
      ema50_4H
    ) {

      score++;

      motivos.push(
        "BTC 4H > EMA50"
      );

    } else {

      motivos.push(
        "BTC 4H < EMA50"
      );

    }

    if (
      ema21_4H >
      ema50_4H
    ) {

      score++;

      motivos.push(
        "BTC 4H EMA21 > EMA50"
      );

    } else {

      motivos.push(
        "BTC 4H EMA21 <= EMA50"
      );

    }

    const distanciaEMA21 =
      (
        preco4H -
        ema21_4H
      ) /
      ema21_4H;

    const quente =
      distanciaEMA21 >
        MERCADO_ESTICADO ||
      rsi4H >
        RSI_MERCADO_QUENTE;

    const favoravel =
      score >=
      SCORE_MERCADO_MINIMO;

    console.log(
      `🌎 BTC: ${preco4H.toFixed(2)}`
    );

    console.log(
      `📊 BTC RSI 4H: ${rsi4H.toFixed(2)}`
    );

    console.log(
      `📏 BTC distância EMA21: ${(distanciaEMA21 * 100).toFixed(2)}%`
    );

    console.log(
      `📊 SCORE MERCADO: ${score}/4`
    );

    console.log(
      `🔥 MERCADO QUENTE: ${quente ? "SIM" : "NÃO"}`
    );

    console.log(
      favoravel
        ? "🟢 MERCADO FAVORÁVEL"
        : "🔴 MERCADO DESFAVORÁVEL"
    );

    console.log(
      "📝",
      motivos.join(" | ")
    );

    return {

      favoravel,
      quente,
      score,
      rsi4H,
      preco4H,
      ema21_4H,
      ema50_4H,
      motivos

    };

  } catch (err) {

    console.log(
      "❌ ERRO AO AVALIAR MERCADO:",
      erroTexto(err)
    );

    return {

      favoravel: false,
      quente: false,
      score: 0,
      motivo:
        erroTexto(err)

    };

  }

}


/* =========================================================
   VERIFICAR POSIÇÃO
========================================================= */

async function verificarPosicao(
  client,
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

    if (
      ordemUSDT
    ) {

      return {

        ativa: true,

        motivo:
          `Ordem aberta em ${ordemUSDT.symbol}`

      };

    }

    const conta =
      await client.accountInfo();

    for (
      const saldo of
      conta.balances
    ) {

      const asset =
        String(
          saldo.asset || ""
        ).toUpperCase();

      if (
        !asset ||
        asset === "USDT" ||
        ehStablecoin(asset) ||
        ehAlavancada(asset)
      ) {

        continue;

      }

      const quantidade =
        Number(
          saldo.free || 0
        ) +
        Number(
          saldo.locked || 0
        );

      if (
        !Number.isFinite(
          quantidade
        ) ||
        quantidade <= 0
      ) {

        continue;

      }

      const par =
        exchangeInfo.symbols.find(
          item =>
            item.status ===
              "TRADING" &&
            item.quoteAsset ===
              "USDT" &&
            String(
              item.baseAsset || ""
            ).toUpperCase() ===
              asset
        );

      if (!par) {

        continue;

      }

      let precoAtual;

      try {

        precoAtual =
          Number(
            (
              await client.prices({
                symbol:
                  par.symbol
              })
            )[par.symbol]
          );

      } catch (_) {

        continue;

      }

      if (
        !Number.isFinite(
          precoAtual
        ) ||
        precoAtual <= 0
      ) {

        continue;

      }

      const valorUSDT =
        quantidade *
        precoAtual;

      if (
        valorUSDT <
        VALOR_MINIMO_POSICAO
      ) {

        console.log(
          `🧹 DUST IGNORADO: ${asset} = ${valorUSDT.toFixed(4)} USDT`
        );

        continue;

      }

      console.log(
        `🔒 POSIÇÃO REAL: ${asset} = ${valorUSDT.toFixed(2)} USDT`
      );

      return {

        ativa: true,

        motivo:
          `Posição encontrada em ${asset} (${valorUSDT.toFixed(2)} USDT)`

      };

    }

    return {

      ativa: false,

      motivo:
        "Nenhuma posição real"

    };

  } catch (err) {

    console.log(
      "⚠️ ERRO AO VERIFICAR POSIÇÃO:",
      erroTexto(err)
    );

    return {

      ativa: true,

      motivo:
        "Não foi possível confirmar a conta"

    };

  }

}


/* =========================================================
   COOLDOWN
========================================================= */

function verificarCooldown(
  estado,
  symbol
) {

  const agora =
    Date.now();

  if (
    estado.ultimaVenda > 0 &&
    agora -
      estado.ultimaVenda <
      COOLDOWN_GERAL
  ) {

    const restante =
      (
        COOLDOWN_GERAL -
        (
          agora -
          estado.ultimaVenda
        )
      ) /
      60000;

    return {

      bloqueado: true,

      motivo:
        `Cooldown geral: ${restante.toFixed(0)} min`

    };

  }

  if (
    estado.ultimaMoedaOperada ===
      symbol &&
    agora -
      estado.horarioUltimaOperacaoMoeda <
      COOLDOWN_MESMA_MOEDA
  ) {

    const restante =
      (
        COOLDOWN_MESMA_MOEDA -
        (
          agora -
          estado.horarioUltimaOperacaoMoeda
        )
      ) /
      60000;

    return {

      bloqueado: true,

      motivo:
        `${symbol} em cooldown: ${restante.toFixed(0)} min`

    };

  }

  return {

    bloqueado: false,

    motivo:
      "Liberado"

  };

}


/* =========================================================
   ANALISAR MOEDA
========================================================= */

async function analisarMoeda(
  client,
  symbol,
  mercado
) {

  try {

    let score = 0;

    const motivos = [];


    /* ================================
       1D
    ================================= */

    const candles1D =
      await client.candles({

        symbol,

        interval:
          INTERVALO_1D,

        limit:
          250

      });

    const closes1D =
      candles1D
        .slice(0, -1)
        .map(
          c => Number(c.close)
        );

    if (
      closes1D.length < 200
    ) {

      return {

        valido: false,

        motivo:
          "Poucos candles 1D"

      };

    }

    const ema50_1D =
      calcularEMA(
        closes1D,
        50
      );

    const ema200_1D =
      calcularEMA(
        closes1D,
        200
      );

    const preco1D =
      closes1D.at(-1);

    if (
      preco1D >
      ema50_1D
    ) {

      score += 2;

      motivos.push(
        "1D preço > EMA50 +2"
      );

    } else {

      motivos.push(
        "1D preço < EMA50"
      );

    }

    if (
      ema50_1D >
      ema200_1D
    ) {

      score++;

      motivos.push(
        "1D EMA50 > EMA200 +1"
      );

    } else {

      motivos.push(
        "1D EMA50 <= EMA200"
      );

    }


    /* ================================
       4H
    ================================= */

    const candles4H =
      await client.candles({

        symbol,

        interval:
          INTERVALO_4H,

        limit:
          150

      });

    const closes4H =
      candles4H
        .slice(0, -1)
        .map(
          c => Number(c.close)
        );

    if (
      closes4H.length < 50
    ) {

      return {

        valido: false,

        motivo:
          "Poucos candles 4H"

      };

    }

    const ema21_4H =
      calcularEMA(
        closes4H,
        21
      );

    const ema50_4H =
      calcularEMA(
        closes4H,
        50
      );

    const preco4H =
      closes4H.at(-1);

    if (
      preco4H >
      ema50_4H
    ) {

      score += 2;

      motivos.push(
        "4H preço > EMA50 +2"
      );

    } else {

      motivos.push(
        "4H preço < EMA50"
      );

    }

    if (
      ema21_4H >
      ema50_4H
    ) {

      score++;

      motivos.push(
        "4H EMA21 > EMA50 +1"
      );

    } else {

      motivos.push(
        "4H EMA21 <= EMA50"
      );

    }


    /* ================================
       15M
    ================================= */

    const candles15M =
      await client.candles({

        symbol,

        interval:
          INTERVALO_ENTRADA,

        limit:
          120

      });

    const fechados15M =
      candles15M.slice(
        0,
        -1
      );

    const closes =
      fechados15M.map(
        c => Number(c.close)
      );

    const opens =
      fechados15M.map(
        c => Number(c.open)
      );

    const highs =
      fechados15M.map(
        c => Number(c.high)
      );

    const lows =
      fechados15M.map(
        c => Number(c.low)
      );

    const volumes =
      fechados15M.map(
        c => Number(c.volume)
      );

    if (
      closes.length < 50
    ) {

      return {

        valido: false,

        motivo:
          "Poucos candles 15M"

      };

    }

    const ema9 =
      calcularEMA(
        closes,
        9
      );

    const ema21 =
      calcularEMA(
        closes,
        21
      );

    const rsiAtual =
      calcularRSI(
        closes,
        14
      );

    const ultimo =
      closes.length - 1;

    const preco =
      closes[ultimo];

    const abertura =
      opens[ultimo];

    const volume =
      volumes[ultimo];


    /* ================================
       EMA
    ================================= */

    if (
      ema9 >
      ema21
    ) {

      score += 2;

      motivos.push(
        "15M EMA9 > EMA21 +2"
      );

    } else {

      motivos.push(
        "15M EMA9 <= EMA21"
      );

    }


    /* ================================
       RSI
    ================================= */

    if (
      rsiAtual >= RSI_MIN &&
      rsiAtual <= RSI_MAX
    ) {

      score++;

      motivos.push(
        `RSI ${rsiAtual.toFixed(2)} +1`
      );

    } else {

      motivos.push(
        `RSI ${rsiAtual.toFixed(2)}`
      );

    }

    if (
      rsiAtual >
      68
    ) {

      return {

        valido: false,

        motivo:
          `RSI muito alto: ${rsiAtual.toFixed(2)}`

      };

    }


    /* ================================
       DISTÂNCIA EMA21
    ================================= */

    const distanciaEMA21 =
      (
        preco -
        ema21
      ) /
      ema21;

    if (
      distanciaEMA21 >
      DISTANCIA_MAXIMA_ENTRADA
    ) {

      return {

        valido: false,

        motivo:
          `Preço esticado ${(distanciaEMA21 * 100).toFixed(2)}% acima EMA21`

      };

    }

    if (
      Math.abs(
        distanciaEMA21
      ) <=
      DISTANCIA_PULLBACK
    ) {

      score++;

      motivos.push(
        "Preço próximo EMA21 +1"
      );

    }


    /* ================================
       VOLUME
    ================================= */

    const volumesAnteriores =
      volumes.slice(
        -21,
        -1
      );

    const volumeMedio =
      volumesAnteriores.reduce(
        (a, b) =>
          a + b,
        0
      ) /
      Math.max(
        volumesAnteriores.length,
        1
      );

    const volumeRatio =
      volumeMedio > 0
        ? volume / volumeMedio
        : 0;

    if (
      volumeRatio >=
      VOLUME_MINIMO
    ) {

      score++;

      motivos.push(
        `Volume ${(volumeRatio * 100).toFixed(0)}% média +1`
      );

    } else {

      motivos.push(
        "Volume fraco"
      );

    }


    /* ================================
       CANDLE
    ================================= */

    if (
      preco >
      abertura
    ) {

      score++;

      motivos.push(
        "Candle positivo +1"
      );

    }


    /* ================================
       PULLBACK
    ================================= */

    const menorLow =
      Math.min(
        ...lows.slice(-6)
      );

    const distanciaLowEMA =
      Math.abs(
        (
          menorLow -
          ema21
        ) /
        ema21
      );

    const pullback =
      distanciaLowEMA <=
      DISTANCIA_PULLBACK &&
      preco >=
        ema21 * 0.995 &&
      preco <=
        ema21 * 1.04;


    /* ================================
       BREAKOUT
    ================================= */

    const maiorHigh =
      Math.max(
        ...highs.slice(
          -11,
          -1
        )
      );

    const breakout =
      preco >
        maiorHigh &&
      volumeRatio >=
        VOLUME_BREAKOUT &&
      distanciaEMA21 <=
        DISTANCIA_MAXIMA_ENTRADA;

    let tipoEntrada =
      null;


    /* ================================
       ENTRADA
    ================================= */

    if (
      pullback
    ) {

      score++;

      tipoEntrada =
        "PULLBACK";

      motivos.push(
        "PULLBACK +1"
      );

    } else if (
      breakout
    ) {

      if (
        mercado.quente
      ) {

        motivos.push(
          "BREAKOUT BLOQUEADO — MERCADO QUENTE"
        );

      } else {

        score++;

        tipoEntrada =
          "BREAKOUT";

        motivos.push(
          "BREAKOUT +1"
        );

      }

    } else {

      motivos.push(
        "Sem pullback/breakout"
      );

    }


    /* ================================
       MERCADO QUENTE
    ================================= */

    if (
      mercado.quente &&
      tipoEntrada !==
        "PULLBACK"
    ) {

      return {

        valido: false,

        motivo:
          "Mercado muito aquecido — aguardando pullback"

      };

    }


    /* ================================
       SCORE
    ================================= */

    console.log(
      `${symbol} 📊 SCORE ${score}/12 | RSI ${rsiAtual.toFixed(2)} | ${tipoEntrada || "SEM ENTRADA"}`
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

    if (!tipoEntrada) {

      return {

        valido: false,

        motivo:
          "Nenhum ponto de entrada válido"

      };

    }


    /* ================================
       PREÇO ATUAL
    ================================= */

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

    const distanciaAtual =
      (
        precoAtual -
        ema21
      ) /
      ema21;

    if (
      distanciaAtual >
      DISTANCIA_MAXIMA_ENTRADA
    ) {

      return {

        valido: false,

        motivo:
          "Preço ficou esticado durante análise"

      };

    }

    return {

      valido: true,

      precoAtual,

      score,

      rsi:
        rsiAtual,

      ema9,

      ema21,

      tipoEntrada,

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
   EXECUTAR COMPRA
========================================================= */

async function executarCompra(
  client,
  estado,
  symbol,
  exchangeInfo,
  nomeConta
) {

  if (
    estado.operando
  ) {

    return false;

  }

  try {

    estado.operando = true;

    console.log(
      `👤 CONTA: ${nomeConta} | EXECUTANDO COMPRA`
    );


    /* ================================
       POSIÇÃO
    ================================= */

    const posicao =
      await verificarPosicao(
        client,
        exchangeInfo
      );

    if (
      posicao.ativa
    ) {

      console.log(
        "🔒 COMPRA CANCELADA:",
        posicao.motivo
      );

      return false;

    }


    /* ================================
       COOLDOWN
    ================================= */

    const cooldown =
      verificarCooldown(
        estado,
        symbol
      );

    if (
      cooldown.bloqueado
    ) {

      console.log(
        `⏳ ${symbol}: ${cooldown.motivo}`
      );

      return false;

    }


    /* ================================
       SALDO
    ================================= */

    const conta =
      await client.accountInfo();

    const saldoUSDT =
      Number(
        conta.balances.find(
          b =>
            b.asset ===
            "USDT"
        )?.free || 0
      );

    console.log(
      `💵 ${nomeConta} | SALDO USDT: ${saldoUSDT}`
    );

    if (
      !Number.isFinite(
        saldoUSDT
      ) ||
      saldoUSDT <
        15
    ) {

      console.log(
        `❌ ${nomeConta} | SALDO INSUFICIENTE: ${saldoUSDT} USDT`
      );

      return false;

    }


    /* ================================
       PREÇO
    ================================= */

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
        "Preço atual inválido."
      );

    }


    /* ================================
       PAR
    ================================= */

    const info =
      exchangeInfo.symbols.find(
        s =>
          s.symbol ===
          symbol
      );

    if (!info) {

      throw new Error(
        "Par não encontrado."
      );

    }

    const lotSize =
      encontrarFiltro(
        info,
        "LOT_SIZE"
      );

    const priceFilter =
      encontrarFiltro(
        info,
        "PRICE_FILTER"
      );

    if (
      !lotSize ||
      !priceFilter
    ) {

      throw new Error(
        "Filtros Binance não encontrados."
      );

    }

    const stepSize =
      Number(
        lotSize.stepSize
      );

    const tickSize =
      Number(
        priceFilter.tickSize
      );

    const minNotional =
      obterMinimoNotional(
        info
      );


    /* ================================
       QUANTIDADE
    ================================= */

    let quantidadeCompra =
      ajustarQuantidade(
        (
          saldoUSDT *
          PERCENTUAL_ENTRADA
        ) /
        precoAtual,
        stepSize
      );

    if (
      quantidadeCompra <= 0
    ) {

      throw new Error(
        "Quantidade de compra inválida."
      );

    }

    const valorCompra =
      quantidadeCompra *
      precoAtual;

    if (
      minNotional > 0 &&
      valorCompra <
        minNotional
    ) {

      throw new Error(
        `Compra abaixo do mínimo de ${minNotional} USDT`
      );

    }


    /* ================================
       COMPRA
    ================================= */

    console.log(
      "\n========================================"
    );

    console.log(
      `🟢 ${nomeConta} | COMPRA AUTORIZADA: ${symbol}`
    );

    console.log(
      "💰 UTILIZANDO:",
      `${PERCENTUAL_ENTRADA * 100}%`
    );

    console.log(
      "🪙 QUANTIDADE:",
      quantidadeCompra
    );

    console.log(
      "💵 VALOR:",
      valorCompra
    );

    console.log(
      "========================================"
    );

    const ordemCompra =
      await client.order({

        symbol,

        side:
          "BUY",

        type:
          "MARKET",

        quantity:
          quantidadeCompra

      });

    console.log(
      `✅ ${nomeConta} | COMPRA EXECUTADA | PEDIDO: ${ordemCompra.orderId}`
    );


    await sleep(
      3000
    );


    /* ================================
       SALDO DO ATIVO
    ================================= */

    const contaAtualizada =
      await client.accountInfo();

    const asset =
      symbol.replace(
        /USDT$/,
        ""
      );

    let quantidadeReal =
      Number(
        contaAtualizada.balances.find(
          b =>
            b.asset ===
            asset
        )?.free || 0
      );

    quantidadeReal =
      ajustarQuantidade(
        quantidadeReal,
        stepSize
      );

    if (
      quantidadeReal <= 0
    ) {

      throw new Error(
        `Saldo de ${asset} não encontrado.`
      );

    }


    /* ================================
       PREÇO MÉDIO
    ================================= */

    let precoEntrada =
      precoAtual;

    if (
      ordemCompra.fills?.length
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


    /* ================================
       TAKE PROFIT
    ================================= */

    let precoVenda =
      ajustarPreco(
        precoEntrada *
          (
            1 +
            TAKE_PROFIT
          ),
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
        `Venda abaixo do mínimo de ${minNotional} USDT`
      );

    }

    console.log(
      `🎯 ${nomeConta} | ENTRADA: ${precoEntrada}`
    );

    console.log(
      `🎯 ${nomeConta} | TAKE PROFIT: ${precoVenda}`
    );

    console.log(
      "🎯 ALVO: +5%"
    );

    console.log(
      `🛑 STOP LOSS: ${
        STOP_LOSS_ATIVO
          ? "ATIVO"
          : "DESATIVADO"
      }`
    );


    /* ================================
       VENDA LIMIT
    ================================= */

    const ordemVenda =
      await client.order({

        symbol,

        side:
          "SELL",

        type:
          "LIMIT",

        quantity:
          quantidadeReal,

        price:
          precoVenda,

        timeInForce:
          "GTC"

      });

    console.log(
      `✅ ${nomeConta} | ORDEM DE VENDA CRIADA | PEDIDO: ${ordemVenda.orderId}`
    );

    estado.ultimaMoedaOperada =
      symbol;

    estado.horarioUltimaOperacaoMoeda =
      Date.now();

    return true;

  } catch (err) {

    console.log(
      `❌ ${nomeConta} | ERRO NA COMPRA:`,
      erroTexto(err)
    );

    return false;

  } finally {

    estado.operando =
      false;

  }

}


/* =========================================================
   ROBÔ PRINCIPAL
========================================================= */

async function iniciarRobo(
  conta
) {

  const {
    client,
    estado,
    nome
  } = conta;

  console.log(
    `\n🚀 INICIANDO ROBÔ — ${nome}`
  );

  console.log(
    "🔥 ESTRATÉGIA: TOP 20 | BTC 1D+4H | EMA | RSI | PULLBACK/BREAKOUT | SCORE 7/12 | TP +5%"
  );

  console.log(
    "🔒 UMA POSIÇÃO POR VEZ POR CONTA"
  );


  /* =====================================================
     LOOP INFINITO
  ===================================================== */

  while (true) {

    try {

      console.log(
        `\n\n========================================\n👤 CONTA: ${nome}\n🔎 NOVA VARREDURA\n${new Date().toISOString()}\n========================================`
      );


      /* ================================
         EXCHANGE INFO
      ================================= */

      const exchangeInfo =
        await client.exchangeInfo();


      /* ================================
         POSIÇÃO
      ================================= */

      const posicao =
        await verificarPosicao(
          client,
          exchangeInfo
        );

      if (
        posicao.ativa
      ) {

        console.log(
          `🔒 ${nome} | OPERAÇÃO ATIVA: ${posicao.motivo}`
        );

        console.log(
          "⏳ Aguardando TAKE PROFIT."
        );

        await sleep(
          INTERVALO_VARREDURA
        );

        continue;

      }


      /* ================================
         COOLDOWN GERAL
      ================================= */

      if (
        estado.ultimaVenda > 0 &&
        Date.now() -
          estado.ultimaVenda <
          COOLDOWN_GERAL
      ) {

        const restante =
          (
            COOLDOWN_GERAL -
            (
              Date.now() -
              estado.ultimaVenda
            )
          ) /
          60000;

        console.log(
          `⏳ ${nome} | COOLDOWN APÓS VENDA: ${restante.toFixed(0)} minutos`
        );

        await sleep(
          INTERVALO_VARREDURA
        );

        continue;

      }


      /* ================================
         MERCADO
      ================================= */

      const mercado =
        await avaliarMercado(
          client
        );

      if (
        !mercado.favoravel
      ) {

        console.log(
          `🔴 ${nome} | MERCADO NÃO FAVORÁVEL — NENHUMA COMPRA`
        );

        await sleep(
          INTERVALO_VARREDURA
        );

        continue;

      }


      /* ================================
         TOP 20
      ================================= */

      const pares =
        await obterTop20MarketCap(
          exchangeInfo
        );

      if (
        !pares.length
      ) {

        console.log(
          "❌ TOP 20 indisponível."
        );

        await sleep(
          INTERVALO_VARREDURA
        );

        continue;

      }

      console.log(
        "\n📊 TOP 20 MARKET CAP"
      );

      pares.forEach(
        (par, index) => {

          console.log(
            `${index + 1}. ${par.symbol} | ${par.nome} | Rank #${par.rank}`
          );

        }
      );


      /* ================================
         ANALISAR
      ================================= */

      let encontrouEntrada =
        false;

      for (
        const par of pares
      ) {

        if (
          estado.operando
        ) {

          break;

        }

        const estadoAtual =
          await verificarPosicao(
            client,
            exchangeInfo
          );

        if (
          estadoAtual.ativa
        ) {

          console.log(
            `🔒 ${nome} | OPERAÇÃO DETECTADA: ${estadoAtual.motivo}`
          );

          break;

        }

        const cooldown =
          verificarCooldown(
            estado,
            par.symbol
          );

        if (
          cooldown.bloqueado
        ) {

          console.log(
            `${par.symbol} ⏳ ${cooldown.motivo}`
          );

          continue;

        }

        console.log(
          `\n➡️ ${nome} | ANALISANDO: ${par.symbol}`
        );

        const setup =
          await analisarMoeda(
            client,
            par.symbol,
            mercado
          );

        if (
          !setup.valido
        ) {

          console.log(
            `${par.symbol} ❌ ${setup.motivo}`
          );

          await sleep(
            PAUSA_ENTRE_MOEDAS
          );

          continue;

        }

        console.log(
          `🟢 ${nome} | SETUP APROVADO: ${par.symbol} | SCORE ${setup.score}/12 | RSI ${setup.rsi.toFixed(2)} | ${setup.tipoEntrada}`
        );


        /* ================================
           COMPRA
        ================================= */

        const comprou =
          await executarCompra(
            client,
            estado,
            par.symbol,
            exchangeInfo,
            nome
          );

        if (
          comprou
        ) {

          encontrouEntrada =
            true;

          console.log(
            `🚀 ${nome} | OPERAÇÃO ABERTA: ${par.symbol} | ALVO +5%`
          );

          break;

        }

        await sleep(
          PAUSA_ENTRE_MOEDAS
        );

      }

      if (
        !encontrouEntrada
      ) {

        console.log(
          `🔎 ${nome} | NENHUMA ENTRADA ENCONTRADA NESTA VARREDURA.`
        );

      }

    } catch (err) {

      console.log(
        `❌ ${nome} | ERRO NA VARREDURA:`,
        erroTexto(err)
      );

    }


    /* ================================
       PRÓXIMA VARREDURA
    ================================= */

    console.log(
      `⏳ ${nome} | PRÓXIMA VARREDURA EM 15 MINUTOS...`
    );

    await sleep(
      INTERVALO_VARREDURA
    );

  }

}


/* =========================================================
   VALIDAR APIs
========================================================= */

if (
  !process.env.API_KEY_1 ||
  !process.env.API_SECRET_1 ||
  !process.env.API_KEY_2 ||
  !process.env.API_SECRET_2
) {

  console.error(
    "❌ Configure API_KEY_1, API_SECRET_1, API_KEY_2 e API_SECRET_2 no Northflank."
  );

  process.exit(1);

}


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

console.log(
  "🚀 BINANCE-ROBO — 2 CONTAS"
);

console.log(
  "👤 CONTA 1: SUA CONTA"
);

console.log(
  "👤 CONTA 2: CONTA DO AMIGO"
);


/* =========================================================
   CAPTURA DE ERROS
========================================================= */

process.on(
  "unhandledRejection",
  err =>
    console.log(
      "❌ UNHANDLED REJECTION:",
      erroTexto(err)
    )
);

process.on(
  "uncaughtException",
  err =>
    console.log(
      "❌ UNCAUGHT EXCEPTION:",
      erroTexto(err)
    )
);


/* =========================================================
   INICIAR AS DUAS CONTAS
========================================================= */

Promise.all(
  CONTAS.map(
    iniciarRobo
  )
).catch(
  err => {

    console.log(
      "❌ FALHA FATAL NAS CONTAS:",
      erroTexto(err)
    );

    process.exit(1);

  }
);
