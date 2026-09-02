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

// Tendência
const INTERVALO_4H = "4h";
const INTERVALO_1D = "1d";

// TOP 20 por capitalização de mercado
const MAX_MOEDAS = 20;

// Alvo
const TAKE_PROFIT = 0.05;

// Compra usando 95% do saldo
const PERCENTUAL_ENTRADA = 0.95;

// RSI mais acessível
const RSI_MIN = 40;
const RSI_MAX = 65;

// Distância máxima da EMA21
const DISTANCIA_EMA21_MAX = 0.03;

// Volume mínimo
const VOLUME_MINIMO = 0.80;

// Score mínimo para entrada
const SCORE_MINIMO = 6;

// Nova análise a cada 15 minutos
const INTERVALO_VARREDURA = 15 * 60 * 1000;

// Pequena pausa entre moedas
const PAUSA_ENTRE_MOEDAS = 1000;

// Cache do TOP 20
const CACHE_MARKET_CAP = 15 * 60 * 1000;

let cacheMarketCap = [];
let ultimaAtualizacaoMarketCap = 0;

// Controle de operação
let operando = false;


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
  return new Promise(resolve => setTimeout(resolve, ms));
}


function erroTexto(err) {

  if (!err) {
    return "Erro desconhecido";
  }

  if (err.body) {

    try {

      if (typeof err.body === "string") {
        return err.body;
      }

      return JSON.stringify(err.body);

    } catch (_) {

      return String(err.body);

    }

  }

  return err.message || String(err);

}


function ehStablecoin(asset) {

  return STABLECOINS.has(
    String(asset || "").toUpperCase()
  );

}


function ehAlavancada(asset) {

  const nome =
    String(asset || "").toUpperCase();

  return SUFIXOS_ALAVANCADOS.some(
    sufixo => nome.endsWith(sufixo)
  );

}


/* =========================================================
   EMA
========================================================= */

function calcularEMA(valores, periodo) {

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
    valores.length <
      periodo + 1
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


  const forcaRelativa =
    ganhos / perdas;


  return (
    100 -
    100 /
      (1 + forcaRelativa)
  );

}


/* =========================================================
   AJUSTE DE QUANTIDADE E PREÇO
========================================================= */

function casasDecimais(step) {

  const texto =
    String(step);


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
    ) * step;


  return Number(
    ajustado.toFixed(casas)
  );

}


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
    ) * tick;


  return Number(
    ajustado.toFixed(casas)
  );

}


/* =========================================================
   FILTROS DA BINANCE
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
     Usa cache para não chamar
     CoinGecko em toda varredura.
  */

  if (
    cacheMarketCap.length > 0 &&
    agora -
      ultimaAtualizacaoMarketCap <
      CACHE_MARKET_CAP
  ) {

    return cacheMarketCap;

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
         Stablecoins
      */

      if (
        ehStablecoin(simbolo)
      ) {

        continue;

      }


      /*
         Alavancadas
      */

      if (
        ehAlavancada(simbolo)
      ) {

        continue;

      }


      /*
         Procurar par USDT na Binance
      */

      const par =
        exchangeInfo.symbols.find(
          item =>
            item.status === "TRADING" &&
            item.quoteAsset === "USDT" &&
            String(
              item.baseAsset
            ).toUpperCase() === simbolo
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
         Não aceitar moedas muito novas.
      */

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
          par.symbol,
          "⛔ MOEDA NOVA"
        );

        continue;

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


    return resultado;


  } catch (err) {

    console.log(
      "❌ ERRO MARKET CAP:",
      erroTexto(err)
    );


    /*
       Se CoinGecko falhar, utiliza
       o último ranking conhecido.
    */

    if (
      cacheMarketCap.length > 0
    ) {

      console.log(
        "♻️ USANDO ÚLTIMO TOP 20 DISPONÍVEL"
      );

      return cacheMarketCap;

    }


    return [];

  }

}


/* =========================================================
   VERIFICAR SALDO / POSIÇÃO
========================================================= */

async function verificarPosicao(
  exchangeInfo
) {

  try {

    /*
       Primeiro verifica ordens abertas.
    */

    const ordens =
      await client.openOrders();


    if (
      ordens &&
      ordens.length > 0
    ) {

      const ordemUSDT =
        ordens.find(
          ordem =>
            String(
              ordem.symbol || ""
            ).endsWith("USDT")
        );


      if (ordemUSDT) {

        return {

          ativa: true,

          motivo:
            `Ordem aberta em ${ordemUSDT.symbol}`

        };

      }

    }


    /*
       Depois verifica saldos.
    */

    const conta =
      await client.accountInfo();


    for (
      const saldo of conta.balances
    ) {

      const asset =
        String(
          saldo.asset || ""
        ).toUpperCase();


      if (
        !asset ||
        asset === "USDT"
      ) {

        continue;

      }


      if (
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
        quantidade <= 0
      ) {

        continue;

      }


      const possuiUSDT =
        exchangeInfo.symbols.some(
          par =>
            par.status === "TRADING" &&
            par.quoteAsset === "USDT" &&
            String(
              par.baseAsset
            ).toUpperCase() === asset
        );


      if (
        possuiUSDT
      ) {

        return {

          ativa: true,

          motivo:
            `Posição encontrada em ${asset}`

        };

      }

    }


    return {

      ativa: false,

      motivo:
        "Nenhuma posição ativa"

    };


  } catch (err) {

    console.log(
      "⚠️ ERRO AO CONSULTAR CONTA:",
      erroTexto(err)
    );


    /*
       Por segurança, se não conseguimos
       consultar a conta, não compramos.
    */

    return {

      ativa: true,

      motivo:
        "Não foi possível confirmar a conta"

    };

  }

}


/* =========================================================
   ANALISAR MOEDA
========================================================= */

async function analisarMoeda(
  symbol
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
          INTERVALO_1D,

        limit: 250

      });


    /*
       Ignora candle ainda aberto.
    */

    const fechados1D =
      candles1D.slice(
        0,
        -1
      );


    const fechamentos1D =
      fechados1D.map(
        c =>
          Number(c.close)
      );


    if (
      fechamentos1D.length < 200
    ) {

      return {

        valido: false,

        motivo:
          "Poucos candles 1D"

      };

    }


    const ema50_1D =
      calcularEMA(
        fechamentos1D,
        50
      );


    const ema200_1D =
      calcularEMA(
        fechamentos1D,
        200
      );


    const preco1D =
      fechamentos1D[
        fechamentos1D.length - 1
      ];


    /*
       PREÇO > EMA50
       Muito importante.
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
       EMA50 > EMA200
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


    /*
       NÃO eliminamos a moeda aqui.
       Ela apenas perde pontos.
    */


    /* =====================================================
       4H
    ===================================================== */

    const candles4H =
      await client.candles({

        symbol,

        interval:
          INTERVALO_4H,

        limit: 150

      });


    const fechados4H =
      candles4H.slice(
        0,
        -1
      );


    const fechamentos4H =
      fechados4H.map(
        c =>
          Number(c.close)
      );


    if (
      fechamentos4H.length < 50
    ) {

      return {

        valido: false,

        motivo:
          "Poucos candles 4H"

      };

    }


    const ema21_4H =
      calcularEMA(
        fechamentos4H,
        21
      );


    const ema50_4H =
      calcularEMA(
        fechamentos4H,
        50
      );


    const preco4H =
      fechamentos4H[
        fechamentos4H.length - 1
      ];


    /*
       PREÇO > EMA50
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

    }


    /* =====================================================
       15M
    ===================================================== */

    const candles15M =
      await client.candles({

        symbol,

        interval:
          INTERVALO_ENTRADA,

        limit: 120

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


    const maximo =
      highs[ultimo];


    const minimo =
      lows[ultimo];


    const volume =
      volumes[ultimo];


    /*
       EMA9 > EMA21
    */

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


    /*
       RSI
    */

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
       Distância EMA21
    */

    const distanciaEMA21 =
      Math.abs(
        (
          preco -
          ema21
        ) /
        ema21
      );


    if (
      distanciaEMA21 <=
      DISTANCIA_EMA21_MAX
    ) {

      score += 1;

      motivos.push(
        `Preço próximo EMA21 +1`
      );

    } else {

      motivos.push(
        `Preço ${(distanciaEMA21 * 100).toFixed(2)}% da EMA21`
      );

    }


    /*
       Volume
    */

    const volumesAnteriores =
      volumes.slice(
        -21,
        -1
      );


    const volumeMedio =
      volumesAnteriores.reduce(
        (a, b) => a + b,
        0
      ) /
      Math.max(
        volumesAnteriores.length,
        1
      );


    if (
      volumeMedio > 0 &&
      volume >=
        volumeMedio *
        VOLUME_MINIMO
    ) {

      score += 1;

      motivos.push(
        `Volume ${(volume / volumeMedio * 100).toFixed(0)}% da média +1`
      );

    } else {

      motivos.push(
        "Volume fraco"
      );

    }


    /*
       Candle positivo
    */

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

    const lowsRecentes =
      lows.slice(-6);


    const menorLow =
      Math.min(
        ...lowsRecentes
      );


    const distanciaLow =
      Math.abs(
        (
          menorLow -
          ema21
        ) /
        ema21
      );


    const pullback =
      distanciaLow <=
      DISTANCIA_EMA21_MAX;


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
      volumeMedio > 0 &&
      volume >=
        volumeMedio;


    if (
      pullback
    ) {

      score += 1;

      motivos.push(
        "PULLBACK +1"
      );

    } else if (
      breakout
    ) {

      score += 1;

      motivos.push(
        "BREAKOUT +1"
      );

    } else {

      motivos.push(
        "Sem pullback/breakout"
      );

    }


    /* =====================================================
       PROTEÇÃO CONTRA COMPRA MUITO ESTICADA
    ===================================================== */

    const distanciaPrecoEMA21 =
      (
        preco -
        ema21
      ) /
      ema21;


    /*
       Se estiver mais de 6% acima
       da EMA21, evitamos entrar
       perseguindo preço.
    */

    if (
      distanciaPrecoEMA21 >
      0.06
    ) {

      return {

        valido: false,

        motivo:
          "Preço muito esticado"

      };

    }


    /* =====================================================
       RESULTADO
    ===================================================== */

    console.log(
      `${symbol} 📊 SCORE ${score}/12 | RSI ${rsiAtual.toFixed(2)}`
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


    /*
       Preço atual em tempo real
    */

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

      rsi:
        rsiAtual,

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
   EXECUTAR COMPRA
========================================================= */

async function executarCompra(
  symbol,
  exchangeInfo
) {

  if (operando) {

    console.log(
      "⏸️ Já existe uma operação sendo executada."
    );

    return false;

  }


  try {

    operando = true;


    /* =====================================================
       CONFIRMAÇÃO FINAL
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


    const conta =
      await client.accountInfo();


    const saldoUSDT =
      Number(
        conta.balances.find(
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
        "❌ SALDO INSUFICIENTE:",
        saldoUSDT,
        "USDT"
      );

      return false;

    }


    /*
       Preço atual
    */

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


    /*
       Informações do par
    */

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
        "Filtros da Binance não encontrados."
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

       95% DO SALDO USDT
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
      "💵 SALDO USDT:",
      saldoUSDT
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
       ORDEM MARKET BUY
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
      "✅ COMPRA EXECUTADA"
    );


    console.log(
      "🆔 ORDER:",
      ordemCompra.orderId
    );


    await sleep(3000);


    /* =====================================================
       OBTER QUANTIDADE REAL
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
       PREÇO MÉDIO REAL DA COMPRA
    ===================================================== */

    let precoEntrada =
      precoAtual;


    if (
      ordemCompra.fills &&
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


    /* =====================================================
       TAKE PROFIT +5%
    ===================================================== */

    let precoVenda =
      precoEntrada *
      (1 + TAKE_PROFIT);


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
      "\n🎯 ================================"
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
      "🎯 ALVO:",
      "+5%"
    );


    console.log(
      "🛑 STOP LOSS: DESATIVADO"
    );


    console.log(
      "🎯 ================================"
    );


    /* =====================================================
       ORDEM LIMIT SELL
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
      "✅ ORDEM DE VENDA CRIADA"
    );


    console.log(
      "🆔 ORDER:",
      ordemVenda.orderId
    );


    console.log(
      `🎯 AGUARDANDO +${TAKE_PROFIT * 100}%`
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


/* =========================================================
   ROBÔ PRINCIPAL
========================================================= */

async function iniciarRobo() {

  console.log(
    "\n🔥 ========================================"
  );

  console.log(
    "🔥 ROBÔ BINANCE INICIADO"
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
    "📊 SCORE MÍNIMO: 6/12"
  );

  console.log(
    "📈 RSI: 40–65"
  );

  console.log(
    "📊 VOLUME: ≥ 80% MÉDIA"
  );

  console.log(
    "🔄 ENTRADA: PULLBACK OU BREAKOUT"
  );

  console.log(
    "🔒 UMA POSIÇÃO POR VEZ"
  );

  console.log(
    "========================================\n"
  );


  /*
     LOOP INFINITO
  */

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
         INFORMAÇÕES DA BINANCE
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
          "❌ Não foi possível obter o TOP 20."
        );


        await sleep(
          INTERVALO_VARREDURA
        );


        continue;

      }


      console.log(
        "\n📊 TOP 20:"
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

      for (
        const par of pares
      ) {

        /*
           Se durante a análise
           outra operação foi aberta,
           parar.
        */

        if (
          operando
        ) {

          break;

        }


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


        console.log(
          `\n➡️ ANALISANDO: ${par.symbol}`
        );


        const setup =
          await analisarMoeda(
            par.symbol
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
          "📝",
          setup.motivos.join(
            " | "
          )
        );


        console.log(
          "🟢 ========================================"
        );


        /* =====================================================
           COMPRAR
        ===================================================== */

        const comprou =
          await executarCompra(
            par.symbol,
            exchangeInfo
          );


        if (
          comprou
        ) {

          console.log(
            "\n🚀 ========================================"
          );


          console.log(
            `🚀 OPERAÇÃO ABERTA: ${par.symbol}`
          );


          console.log(
            "🚀 TAKE PROFIT: +5%"
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


    } catch (err) {

      console.log(
        "\n❌ ERRO NA VARREDURA:"
      );


      console.log(
        erroTexto(err)
      );

    }


    /*
       IMPORTANTE:

       O loop NÃO termina.

       Ele permanece vivo no Northflank.
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
    "❌ ERRO: API_KEY ou API_SECRET não configuradas."
  );


  process.exit(1);

}


/* =========================================================
   START
========================================================= */

console.log(
  "🚀 Iniciando server.js..."
);


/*
   Captura qualquer erro não tratado.
*/

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


/*
   Iniciar o robô.

   Não existe process.exit(0)
   no fluxo normal.
*/

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
