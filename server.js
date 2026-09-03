require("dotenv").config();

const Binance = require("binance-api-node").default;


/* =========================================================
   BINANCE
========================================================= */

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET
});


/* =========================================================
   CONFIGURAÇÕES PRINCIPAIS
========================================================= */

// Timeframe de entrada
const INTERVALO_ENTRADA = "15m";

// Timeframes de tendência
const INTERVALO_4H = "4h";
const INTERVALO_1D = "1d";

// TOP 20 por capitalização de mercado
const MAX_MOEDAS = 20;


/* =========================================================
   OPERAÇÃO
========================================================= */

// Alvo de lucro
const TAKE_PROFIT = 0.05;

// NÃO ALTERAR:
// Compra utilizando 95% do saldo
const PERCENTUAL_ENTRADA = 0.98;

// Stop Loss continua desligado
const STOP_LOSS_ATIVO = false;


/* =========================================================
   FILTRO DE ENTRADA
========================================================= */

// RSI saudável
const RSI_MIN = 40;
const RSI_MAX = 65;

// Se estiver mais de 4% acima da EMA21,
// considera preço muito esticado
const DISTANCIA_MAXIMA_ENTRADA = 0.04;

// Para pullback, preferimos proximidade maior
const DISTANCIA_PULLBACK = 0.025;

// Volume mínimo
const VOLUME_MINIMO = 0.80;

// Breakout precisa de volume mais forte
const VOLUME_BREAKOUT = 1.30;

// Score mínimo
const SCORE_MINIMO = 7;


/* =========================================================
   FILTRO DO MERCADO
========================================================= */

// Score mínimo para considerar o mercado favorável
const SCORE_MERCADO_MINIMO = 2;

// BTC acima de 4% da EMA21 4H
// = mercado possivelmente muito aquecido
const MERCADO_ESTICADO = 0.04;

// RSI 4H acima disso também caracteriza mercado quente
const RSI_MERCADO_QUENTE = 70;


/* =========================================================
   TEMPOS
========================================================= */

// Varredura a cada 15 minutos
const INTERVALO_VARREDURA =
  15 * 60 * 1000;

// Pausa entre moedas
const PAUSA_ENTRE_MOEDAS =
  1000;

// Após fechar uma operação,
// aguarda 30 minutos antes de nova compra
const COOLDOWN_GERAL =
  30 * 60 * 1000;

// Não recomprar a mesma moeda imediatamente
const COOLDOWN_MESMA_MOEDA =
  2 * 60 * 60 * 1000;

// Cache do Market Cap
const CACHE_MARKET_CAP =
  15 * 60 * 1000;


/* =========================================================
   DUST
========================================================= */

// Saldo inferior a 5 USDT será considerado
// apenas resíduo e não bloqueará o robô.
const VALOR_MINIMO_POSICAO = 5;


/* =========================================================
   CONTROLE
========================================================= */

let operando = false;

let cacheMarketCap = [];

let ultimaAtualizacaoMarketCap = 0;

let ultimaVenda = 0;

let ultimaMoedaOperada = null;

let horarioUltimaOperacaoMoeda = 0;


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

      if (
        typeof err.body === "string"
      ) {

        return err.body;

      }


      return JSON.stringify(
        err.body
      );


    } catch (_) {

      return String(
        err.body
      );

    }

  }


  return (
    err.message ||
    String(err)
  );

}


/* =========================================================
   STABLECOIN
========================================================= */

function ehStablecoin(asset) {

  return STABLECOINS.has(
    String(
      asset || ""
    ).toUpperCase()
  );

}


/* =========================================================
   ALAVANCADA
========================================================= */

function ehAlavancada(asset) {

  const nome =
    String(
      asset || ""
    ).toUpperCase();


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
      Number(
        valores[i]
      );

  }


  mediaInicial /=
    periodo;


  const multiplicador =
    2 /
    (periodo + 1);


  let resultado =
    mediaInicial;


  for (
    let i = periodo;
    i < valores.length;
    i++
  ) {

    resultado =
      (
        Number(
          valores[i]
        ) -
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
    valores.length <
      periodo + 1
  ) {

    return null;

  }


  let ganhos = 0;

  let perdas = 0;


  const inicio =
    valores.length -
    periodo;


  for (
    let i = inicio;
    i < valores.length;
    i++
  ) {

    const diferenca =
      Number(
        valores[i]
      ) -
      Number(
        valores[i - 1]
      );


    if (
      diferenca > 0
    ) {

      ganhos +=
        diferenca;

    } else {

      perdas +=
        Math.abs(
          diferenca
        );

    }

  }


  if (
    perdas === 0
  ) {

    return 100;

  }


  const rs =
    ganhos /
    perdas;


  return (
    100 -
    100 /
      (1 + rs)
  );

}


/* =========================================================
   CASAS DECIMAIS
========================================================= */

function casasDecimais(
  valor
) {

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


  const ajustado =
    Math.floor(
      valor / step
    ) *
    step;


  return Number(
    ajustado.toFixed(
      casas
    )
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


  const ajustado =
    Math.floor(
      valor / tick
    ) *
    tick;


  return Number(
    ajustado.toFixed(
      casas
    )
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
      filtro.filterType ===
      tipo
  );

}


/* =========================================================
   MIN NOTIONAL
========================================================= */

function obterMinimoNotional(
  info
) {

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


  if (
    antigo?.minNotional
  ) {

    return Number(
      antigo.minNotional
    );

  }


  return 0;

}


/* =========================================================
   TOP 20 MARKET CAP
========================================================= */

async function obterTop20MarketCap(
  exchangeInfo
) {

  const agora =
    Date.now();


  /*
     Utilizar cache evita consultas
     excessivas ao CoinGecko.
  */

  if (
    cacheMarketCap.length > 0 &&
    (
      agora -
      ultimaAtualizacaoMarketCap
    ) <
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


    if (
      !resposta.ok
    ) {

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


      if (!simbolo) {

        continue;

      }


      /*
         Stablecoin
      */

      if (
        ehStablecoin(
          simbolo
        )
      ) {

        continue;

      }


      /*
         Alavancada
      */

      if (
        ehAlavancada(
          simbolo
        )
      ) {

        continue;

      }


      /*
         Procurar par USDT na Binance.
      */

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
        ehStablecoin(base)
      ) {

        continue;

      }


      if (
        ehAlavancada(base)
      ) {

        continue;

      }


      /*
         Evitar moedas muito novas.
      */

      if (
        par.onboardDate
      ) {

        const idade =
          Date.now() -
          Number(
            par.onboardDate
          );


        if (
          idade <
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

      }


      resultado.push({

        symbol:
          par.symbol,

        baseAsset:
          base,

        nome:
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
      cacheMarketCap.length > 0
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

async function avaliarMercado() {

  try {

    console.log(
      "\n🌎 ========================================"
    );

    console.log(
      "🌎 AVALIANDO MERCADO"
    );

    console.log(
      "🌎 ========================================"
    );


    /*
       BTC 1D
    */

    const candles1D =
      await client.candles({

        symbol:
          "BTCUSDT",

        interval:
          "1d",

        limit:
          250

      });


    const fechados1D =
      candles1D.slice(
        0,
        -1
      );


    const closes1D =
      fechados1D.map(
        c =>
          Number(c.close)
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
      closes1D[
        closes1D.length - 1
      ];


    let score = 0;

    const motivos = [];


    /*
       BTC acima EMA50 1D
    */

    if (
      preco1D >
      ema50_1D
    ) {

      score += 1;

      motivos.push(
        "BTC 1D > EMA50"
      );

    } else {

      motivos.push(
        "BTC 1D < EMA50"
      );

    }


    /*
       BTC EMA50 > EMA200
    */

    if (
      ema50_1D >
      ema200_1D
    ) {

      score += 1;

      motivos.push(
        "BTC EMA50 > EMA200"
      );

    } else {

      motivos.push(
        "BTC EMA50 <= EMA200"
      );

    }


    /*
       BTC 4H
    */

    const candles4H =
      await client.candles({

        symbol:
          "BTCUSDT",

        interval:
          "4h",

        limit:
          150

      });


    const fechados4H =
      candles4H.slice(
        0,
        -1
      );


    const closes4H =
      fechados4H.map(
        c =>
          Number(c.close)
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
      closes4H[
        closes4H.length - 1
      ];


    /*
       BTC 4H acima EMA50
    */

    if (
      preco4H >
      ema50_4H
    ) {

      score += 1;

      motivos.push(
        "BTC 4H > EMA50"
      );

    } else {

      motivos.push(
        "BTC 4H < EMA50"
      );

    }


    /*
       EMA21 > EMA50
    */

    if (
      ema21_4H >
      ema50_4H
    ) {

      score += 1;

      motivos.push(
        "BTC 4H EMA21 > EMA50"
      );

    } else {

      motivos.push(
        "BTC 4H EMA21 <= EMA50"
      );

    }


    /*
       Detectar mercado muito quente.
    */

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


    if (
      favoravel
    ) {

      console.log(
        "🟢 MERCADO FAVORÁVEL"
      );

    } else {

      console.log(
        "🔴 MERCADO DESFAVORÁVEL"
      );

    }


    console.log(
      "📝",
      motivos.join(
        " | "
      )
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
  exchangeInfo
) {

  try {

    /*
       PRIMEIRO:
       ordens abertas.
    */

    const ordens =
      await client.openOrders();


    const ordemUSDT =
      ordens.find(
        ordem =>
          String(
            ordem.symbol || ""
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


    /*
       Depois verificar saldos.
    */

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


      if (!asset) {

        continue;

      }


      if (
        asset === "USDT"
      ) {

        continue;

      }


      if (
        ehStablecoin(asset)
      ) {

        continue;

      }


      if (
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


      /*
         Procurar par USDT.
      */

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

        const preco =
          await client.prices({
            symbol:
              par.symbol
          });


        precoAtual =
          Number(
            preco[
              par.symbol
            ]
          );


      } catch (err) {

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


      /*
         DUST:
         ignorar resíduos pequenos.
      */

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


    /*
       Segurança:
       se não sabemos o estado da conta,
       NÃO fazemos nova compra.
    */

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
  symbol
) {

  const agora =
    Date.now();


  /*
     Cooldown geral
    */

  if (
    ultimaVenda > 0 &&
    agora -
      ultimaVenda <
      COOLDOWN_GERAL
  ) {

    const restante =
      (
        COOLDOWN_GERAL -
        (
          agora -
          ultimaVenda
        )
      ) /
      60000;


    return {

      bloqueado: true,

      motivo:
        `Cooldown geral: ${restante.toFixed(0)} min`

    };

  }


  /*
     Cooldown da mesma moeda.
  */

  if (
    ultimaMoedaOperada ===
      symbol &&
    agora -
      horarioUltimaOperacaoMoeda <
      COOLDOWN_MESMA_MOEDA
  ) {

    const restante =
      (
        COOLDOWN_MESMA_MOEDA -
        (
          agora -
          horarioUltimaOperacaoMoeda
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
  symbol,
  mercado
) {

  try {

    let score = 0;

    const motivos = [];


    /* =====================================================
       1D
    ===================================================== */

    const candles1D =
      await client.candles({

        symbol,

        interval:
          "1d",

        limit:
          250

      });


    const fechados1D =
      candles1D.slice(
        0,
        -1
      );


    const closes1D =
      fechados1D.map(
        c =>
          Number(c.close)
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
      closes1D[
        closes1D.length - 1
      ];


    /*
       Tendência 1D
    */

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


    /*
       Estrutura 1D
    */

    if (
      ema50_1D >
      ema200_1D
    ) {

      score += 1;

      motivos.push(
        "1D EMA50 > EMA200 +1"
      );

    } else {

      motivos.push(
        "1D EMA50 <= EMA200"
      );

    }


    /* =====================================================
       4H
    ===================================================== */

    const candles4H =
      await client.candles({

        symbol,

        interval:
          "4h",

        limit:
          150

      });


    const fechados4H =
      candles4H.slice(
        0,
        -1
      );


    const closes4H =
      fechados4H.map(
        c =>
          Number(c.close)
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
      closes4H[
        closes4H.length - 1
      ];


    /*
       Preço acima EMA50
    */

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


    /*
       EMA21 > EMA50
    */

    if (
      ema21_4H >
      ema50_4H
    ) {

      score += 1;

      motivos.push(
        "4H EMA21 > EMA50 +1"
      );

    } else {

      motivos.push(
        "4H EMA21 <= EMA50"
      );

    }


    /* =====================================================
       15M
    ===================================================== */

    const candles15M =
      await client.candles({

        symbol,

        interval:
          "15m",

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
        c =>
          Number(c.close)
      );


    const opens =
      fechados15M.map(
        c =>
          Number(c.open)
      );


    const highs =
      fechados15M.map(
        c =>
          Number(c.high)
      );


    const lows =
      fechados15M.map(
        c =>
          Number(c.low)
      );


    const volumes =
      fechados15M.map(
        c =>
          Number(c.volume)
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


    /* =====================================================
       EMA 9 > EMA21
    ===================================================== */

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


    /* =====================================================
       RSI
    ===================================================== */

    if (
      rsiAtual >= RSI_MIN &&
      rsiAtual <= RSI_MAX
    ) {

      score += 1;

      motivos.push(
        `RSI ${rsiAtual.toFixed(2)} +1`
      );

    } else {

      motivos.push(
        `RSI ${rsiAtual.toFixed(2)}`
      );

    }


    /*
       RSI muito alto:
       não comprar topo.
    */

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


    /* =====================================================
       DISTÂNCIA EMA21
    ===================================================== */

    const distanciaEMA21 =
      (
        preco -
        ema21
      ) /
      ema21;


    /*
       Preço abaixo EMA21 em pequena correção
       pode ser aceitável.

       Mas acima de 4%:
       não perseguir.
    */

    if (
      distanciaEMA21 >
      DISTANCIA_MAXIMA_ENTRADA
    ) {

      return {

        valido: false,

        motivo:
          `Preço esticado ${(
            distanciaEMA21 *
            100
          ).toFixed(2)}% acima EMA21`

      };

    }


    /*
       Proximidade da EMA21
    */

    if (
      Math.abs(
        distanciaEMA21
      ) <=
      DISTANCIA_PULLBACK
    ) {

      score += 1;

      motivos.push(
        "Preço próximo EMA21 +1"
      );

    }


    /* =====================================================
       VOLUME
    ===================================================== */

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
        ? volume /
          volumeMedio
        : 0;


    if (
      volumeRatio >=
      VOLUME_MINIMO
    ) {

      score += 1;

      motivos.push(
        `Volume ${(volumeRatio * 100).toFixed(0)}% média +1`
      );

    } else {

      motivos.push(
        "Volume fraco"
      );

    }


    /* =====================================================
       CANDLE POSITIVO
    ===================================================== */

    if (
      preco >
      abertura
    ) {

      score += 1;

      motivos.push(
        "Candle positivo +1"
      );

    }


    /* =====================================================
       PULLBACK
    ===================================================== */

    const ultimosLows =
      lows.slice(
        -6
      );


    const menorLow =
      Math.min(
        ...ultimosLows
      );


    /*
       O preço tocou/chegou próximo da EMA21
       recentemente.
    */

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
        ema21 *
        0.995 &&
      preco <=
        ema21 *
        1.04;


    /* =====================================================
       BREAKOUT
    ===================================================== */

    const highsAnteriores =
      highs.slice(
        -11,
        -1
      );


    const maiorHigh =
      Math.max(
        ...highsAnteriores
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


    /*
       PULLBACK TEM PRIORIDADE.
    */

    if (
      pullback
    ) {

      score += 1;

      tipoEntrada =
        "PULLBACK";

      motivos.push(
        "PULLBACK +1"
      );

    } else if (
      breakout
    ) {

      /*
         Se o mercado estiver quente,
         NÃO compramos breakout.
      */

      if (
        mercado.quente
      ) {

        motivos.push(
          "BREAKOUT BLOQUEADO — MERCADO QUENTE"
        );

      } else {

        score += 1;

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


    /* =====================================================
       SE MERCADO ESTIVER QUENTE
    ===================================================== */

    if (
      mercado.quente
    ) {

      /*
         Mercado quente:
         somente pullback.
      */

      if (
        tipoEntrada !==
        "PULLBACK"
      ) {

        return {

          valido: false,

          motivo:
            "Mercado muito aquecido — aguardando pullback"

        };

      }

    }


    /* =====================================================
       SCORE
    ===================================================== */

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


    /* =====================================================
       ENTRADA PRECISA SER DEFINIDA
    ===================================================== */

    if (!tipoEntrada) {

      return {

        valido: false,

        motivo:
          "Nenhum ponto de entrada válido"

      };

    }


    /* =====================================================
       PREÇO ATUAL
    ===================================================== */

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


    /*
       Confirmar que o preço atual
       não disparou para muito longe
       enquanto analisávamos.
    */

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
  symbol,
  exchangeInfo
) {

  if (
    operando
  ) {

    console.log(
      "⏸️ Já existe operação em andamento."
    );


    return false;

  }


  try {

    operando = true;


    /* =====================================================
       CONFIRMAR POSIÇÃO
    ===================================================== */

    const estado =
      await verificarPosicao(
        exchangeInfo
      );


    if (
      estado.ativa
    ) {

      console.log(
        "🔒 COMPRA CANCELADA:",
        estado.motivo
      );


      return false;

    }


    /* =====================================================
       COOLDOWN
    ===================================================== */

    const cooldown =
      verificarCooldown(
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


    /* =====================================================
       CONTA
    ===================================================== */

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


    if (
      !Number.isFinite(
        saldoUSDT
      ) ||
      saldoUSDT <
        15
    ) {

      console.log(
        `❌ SALDO INSUFICIENTE: ${saldoUSDT} USDT`
      );


      return false;

    }


    /* =====================================================
       PREÇO
    ===================================================== */

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


    /* =====================================================
       INFORMAÇÕES DO PAR
    ===================================================== */

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


    /* =====================================================
       FÓRMULA DA COMPRA

       NÃO ALTERAR.

       95% DO SALDO.
    ===================================================== */

    let quantidadeCompra =
      (
        saldoUSDT *
        PERCENTUAL_ENTRADA
      ) /
      precoAtual;


    quantidadeCompra =
      ajustarQuantidade(
        quantidadeCompra,
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


    console.log(
      "\n========================================"
    );


    console.log(
      "🟢 COMPRA AUTORIZADA:",
      symbol
    );


    console.log(
      "💵 SALDO:",
      saldoUSDT,
      "USDT"
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


    /* =====================================================
       MARKET BUY

       NÃO ALTERAR.
    ===================================================== */

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
      "✅ COMPRA EXECUTADA"
    );


    console.log(
      "🆔 PEDIDO:",
      ordemCompra.orderId
    );


    await sleep(
      3000
    );


    /* =====================================================
       SALDO REAL
    ===================================================== */

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


    /* =====================================================
       PREÇO MÉDIO REAL
    ===================================================== */

    let precoEntrada =
      precoAtual;


    if (
      ordemCompra.fills &&
      ordemCompra.fills.length > 0
    ) {

      let quantidadeTotal =
        0;


      let valorTotal =
        0;


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


    /* =====================================================
       TAKE PROFIT +5%

       NÃO ALTERAR.
    ===================================================== */

    let precoVenda =
      precoEntrada *
      (
        1 +
        TAKE_PROFIT
      );


    precoVenda =
      ajustarPreco(
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
        `Venda abaixo do mínimo de ${minNotional} USDT`
      );

    }


    console.log(
      "\n🎯 ========================================"
    );


    console.log(
      "🎯 PREÇO DE ENTRADA:",
      precoEntrada
    );


    console.log(
      "🎯 TAKE PROFIT:",
      precoVenda
    );


    console.log(
      "🎯 ALVO: +5%"
    );


    console.log(
      "🛑 STOP LOSS: DESATIVADO"
    );


    console.log(
      "🎯 ========================================"
    );


    /* =====================================================
       LIMIT SELL

       NÃO ALTERAR.
    ===================================================== */

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
      "✅ ORDEM DE VENDA CRIADA"
    );


    console.log(
      "🆔 PEDIDO:",
      ordemVenda.orderId
    );


    console.log(
      "🎯 AGUARDANDO +5%"
    );


    /*
       Registrar operação.
    */

    ultimaMoedaOperada =
      symbol;


    horarioUltimaOperacaoMoeda =
      Date.now();


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


/* =========================================================
   MONITORAR VENDA / DETECTAR FECHAMENTO
========================================================= */

async function verificarSeVendaFoiConcluida(
  exchangeInfo
) {

  try {

    /*
       Se existe posição real,
       ainda está operando.
    */

    const estado =
      await verificarPosicao(
        exchangeInfo
      );


    return !estado.ativa;


  } catch (err) {

    return false;

  }

}


/* =========================================================
   ROBÔ PRINCIPAL
========================================================= */

async function iniciarRobo() {

  console.log(
    "\n🔥 ========================================"
  );


  console.log(
    "🔥 ROBÔ BINANCE"
  );


  console.log(
    "🔥 ESTRATÉGIA FILTRO DE MERCADO"
  );


  console.log(
    "🔥 TOP 20 MARKET CAP"
  );


  console.log(
    "🔥 ========================================"
  );


  console.log(
    "💰 ENTRADA: 95%"
  );


  console.log(
    "🎯 TAKE PROFIT: +5%"
  );


  console.log(
    "🛑 STOP LOSS: DESATIVADO"
  );


  console.log(
    "📊 SCORE MÍNIMO: 7/12"
  );


  console.log(
    "🌎 FILTRO DE MERCADO: BTC 1D + 4H"
  );


  console.log(
    "📈 RSI: 40–65"
  );


  console.log(
    "📊 VOLUME NORMAL: ≥80%"
  );


  console.log(
    "🚀 BREAKOUT: VOLUME ≥130%"
  );


  console.log(
    "📉 PULLBACK: PRIORIDADE"
  );


  console.log(
    "🚨 PREÇO >4% EMA21: BLOQUEADO"
  );


  console.log(
    "⏳ COOLDOWN: 30 MIN"
  );


  console.log(
    "🧹 DUST <5 USDT: IGNORADO"
  );


  console.log(
    "🔒 UMA POSIÇÃO POR VEZ"
  );


  console.log(
    "========================================\n"
  );


  /* =====================================================
     LOOP INFINITO
  ===================================================== */

  while (true) {

    try {

      console.log(
        "\n\n========================================"
      );


      console.log(
        "🔎 NOVA VARREDURA"
      );


      console.log(
        new Date().toISOString()
      );


      console.log(
        "========================================"
      );


      /* =====================================================
         BINANCE
      ===================================================== */

      const exchangeInfo =
        await client.exchangeInfo();


      /* =====================================================
         VERIFICAR POSIÇÃO
      ===================================================== */

      const estado =
        await verificarPosicao(
          exchangeInfo
        );


      if (
        estado.ativa
      ) {

        console.log(
          "🔒 OPERAÇÃO ATIVA:",
          estado.motivo
        );


        console.log(
          "⏳ Aguardando TAKE PROFIT."
        );


        await sleep(
          INTERVALO_VARREDURA
        );


        continue;

      }


      console.log(
        "✅ SEM POSIÇÃO REAL"
      );


      /* =====================================================
         COOLDOWN GERAL
      ===================================================== */

      if (
        ultimaVenda > 0 &&
        Date.now() -
          ultimaVenda <
          COOLDOWN_GERAL
      ) {

        const restante =
          (
            COOLDOWN_GERAL -
            (
              Date.now() -
              ultimaVenda
            )
          ) /
          60000;


        console.log(
          `⏳ COOLDOWN APÓS VENDA: ${restante.toFixed(0)} minutos`
        );


        await sleep(
          INTERVALO_VARREDURA
        );


        continue;

      }


      /* =====================================================
         PRIMEIRO AVALIAR O MERCADO
      ===================================================== */

      const mercado =
        await avaliarMercado();


      if (
        !mercado.favoravel
      ) {

        console.log(
          "\n🔴 ========================================"
        );


        console.log(
          "🔴 MERCADO NÃO FAVORÁVEL"
        );


        console.log(
          "🔴 NENHUMA COMPRA SERÁ FEITA"
        );


        console.log(
          "⏳ Aguardando próxima avaliação..."
        );


        console.log(
          "🔴 ========================================\n"
        );


        await sleep(
          INTERVALO_VARREDURA
        );


        continue;

      }


      /* =====================================================
         TOP 20
      ===================================================== */

      const pares =
        await obterTop20MarketCap(
          exchangeInfo
        );


      if (
        !pares ||
        pares.length === 0
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
        "\n📊 ========================================"
      );


      console.log(
        "📊 TOP 20 MARKET CAP"
      );


      console.log(
        "📊 ========================================"
      );


      pares.forEach(
        (par, index) => {

          console.log(
            `${index + 1}. ${par.symbol} | ${par.nome} | Rank #${par.rank}`
          );

        }
      );


      /* =====================================================
         ANALISAR MOEDAS
      ===================================================== */

      let encontrouEntrada =
        false;


      for (
        const par of pares
      ) {

        if (
          operando
        ) {

          break;

        }


        /*
           Confirmar posição antes de cada moeda.
        */

        const estadoAtual =
          await verificarPosicao(
            exchangeInfo
          );


        if (
          estadoAtual.ativa
        ) {

          console.log(
            "🔒 OPERAÇÃO DETECTADA:",
            estadoAtual.motivo
          );


          break;

        }


        /*
           Cooldown específico.
        */

        const cooldown =
          verificarCooldown(
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
          `\n➡️ ANALISANDO: ${par.symbol}`
        );


        const setup =
          await analisarMoeda(
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


        /* =====================================================
           SETUP APROVADO
        ===================================================== */

        console.log(
          "\n🟢 ========================================"
        );


        console.log(
          `🟢 SETUP APROVADO: ${par.symbol}`
        );


        console.log(
          `📊 SCORE: ${setup.score}/12`
        );


        console.log(
          `📈 RSI: ${setup.rsi.toFixed(2)}`
        );


        console.log(
          `🎯 TIPO: ${setup.tipoEntrada}`
        );


        console.log(
          `💰 PREÇO: ${setup.precoAtual}`
        );


        console.log(
          "📝",
          setup.motivos.join(
            " | "
          )
        );


        console.log(
          "🟢 ========================================"
        );


        /* =====================================================
           COMPRA
        ===================================================== */

        const comprou =
          await executarCompra(
            par.symbol,
            exchangeInfo
          );


        if (
          comprou
        ) {

          encontrouEntrada =
            true;


          console.log(
            "\n🚀 ========================================"
          );


          console.log(
            `🚀 OPERAÇÃO ABERTA: ${par.symbol}`
          );


          console.log(
            `🚀 TIPO: ${setup.tipoEntrada}`
          );


          console.log(
            "🚀 ALVO: +5%"
          );


          console.log(
            "🚀 ROBÔ AGUARDANDO VENDA"
          );


          console.log(
            "🚀 ========================================\n"
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
          "\n🔎 NENHUMA ENTRADA ENCONTRADA NESTA VARREDURA."
        );

      }


    } catch (err) {

      console.log(
        "\n❌ ERRO NA VARREDURA:"
      );


      console.log(
        erroTexto(err)
      );

    }


    /*
       ========================================================
       IMPORTANTE

       O robô nunca encerra normalmente.

       Depois da varredura, aguarda 15 minutos e começa
       novamente.
       ========================================================
    */

    console.log(
      "\n⏳ PRÓXIMA VARREDURA EM 15 MINUTOS..."
    );


    await sleep(
      INTERVALO_VARREDURA
    );

  }

}


/* =========================================================
   VALIDAR API
========================================================= */

if (
  !process.env.API_KEY ||
  !process.env.API_SECRET
) {

  console.log(
    "❌ API_KEY ou API_SECRET não configuradas."
  );


  process.exit(1);

}


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

console.log(
  "🚀 Iniciando server.js..."
);


console.log(
  "🔐 API configurada."
);


console.log(
  "🇩🇪 Execução preparada para Frankfurt."
);


/* =========================================================
   CAPTURA DE ERROS
========================================================= */

process.on(
  "unhandledRejection",
  err => {

    console.log(
      "❌ UNHANDLED REJECTION:",
      erroTexto(err)
    );

  }
);


process.on(
  "uncaughtException",
  err => {

    console.log(
      "❌ UNCAUGHT EXCEPTION:",
      erroTexto(err)
    );

  }
);


/* =========================================================
   INICIAR
========================================================= */

iniciarRobo()
  .catch(
    err => {

      console.log(
        "❌ FALHA FATAL:",
        erroTexto(err)
      );


      process.exit(1);

    }
  );
