const Binance = require("binance-api-node").default;

const db = require("../database");
const cryptoService = require("../services/cryptoService");

// ============================================================
// CRIPTOPRO - ROBOT ENGINE V7
// ============================================================
//
// Motor de execução por usuário + conta Binance.
//
// Estratégias:
//   v7.1 -> TOP 20 Market Cap + filtro BTC + EMA/RSI + Score
//   v6   -> TOP moedas por volume + EMA/RSI + volume
//
// IMPORTANTE:
// Este arquivo NÃO inicia sozinho.
// O server.js deverá chamar:
//   robotEngine.resumeRunning()
//
// As rotas de start/stop deverão chamar:
//   robotEngine.start(userId, accountId)
//   robotEngine.stop(userId, accountId)
//
// ============================================================


// ============================================================
// CONFIGURAÇÕES GERAIS
// ============================================================

const RUNNERS = new Map();

const RUNNER_INTERVAL_MS = 15000;

const STABLE_ASSETS = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "BUSD",
  "TUSD",
  "USDP",
  "DAI"
]);

const VALID_INTERVALS = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h"
]);


// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function number(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function round(value, decimals = 8) {
  const n = number(value);

  const factor =
    Math.pow(10, decimals);

  return Math.round(
    n * factor
  ) / factor;
}

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}

function runnerKey(userId, accountId) {
  return `${userId}:${accountId}`;
}


// ============================================================
// TIMEFRAME BINANCE
// ============================================================

function intervalToMilliseconds(interval) {
  const map = {
    "1m": 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000
  };

  return (
    map[interval] ||
    map["15m"]
  );
}


// ============================================================
// GARANTIR TABELAS
// ============================================================

async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS robot_configs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,

      strategy_version VARCHAR(20)
        NOT NULL DEFAULT 'v7.1',

      entry_percent NUMERIC(10,4)
        NOT NULL DEFAULT 98,

      take_profit_percent NUMERIC(10,4)
        NOT NULL DEFAULT 5,

      stop_loss_percent NUMERIC(10,4)
        NOT NULL DEFAULT 2.5,

      stop_loss_active BOOLEAN
        NOT NULL DEFAULT TRUE,

      max_operations INTEGER
        NOT NULL DEFAULT 3,

      interval VARCHAR(10)
        NOT NULL DEFAULT '15m',

      max_coins INTEGER
        NOT NULL DEFAULT 20,

      running BOOLEAN
        NOT NULL DEFAULT FALSE,

      created_at TIMESTAMP
        DEFAULT NOW(),

      updated_at TIMESTAMP
        DEFAULT NOW(),

      UNIQUE(user_id, account_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS robot_operations (
      id SERIAL PRIMARY KEY,

      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,

      symbol VARCHAR(30) NOT NULL,

      strategy_version VARCHAR(20),

      buy_order_id VARCHAR(100),

      sell_order_id VARCHAR(100),

      buy_price NUMERIC(30,12),

      quantity NUMERIC(30,12),

      invested_quote NUMERIC(30,12),

      take_profit_price NUMERIC(30,12),

      stop_loss_price NUMERIC(30,12),

      status VARCHAR(30)
        NOT NULL DEFAULT 'OPEN',

      buy_time TIMESTAMP,

      sell_time TIMESTAMP,

      sell_price NUMERIC(30,12),

      pnl_quote NUMERIC(30,12),

      pnl_percent NUMERIC(20,8),

      reason VARCHAR(100),

      metadata JSONB,

      created_at TIMESTAMP
        DEFAULT NOW(),

      updated_at TIMESTAMP
        DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS
    idx_robot_operations_user_account
    ON robot_operations(user_id, account_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS
    idx_robot_operations_status
    ON robot_operations(status)
  `);
}


// ============================================================
// CONTA BINANCE
// ============================================================

async function getAccount(
  userId,
  accountId
) {
  const result = await db.query(
    `
      SELECT
        id,
        user_id,
        name,
        api_key_encrypted,
        api_secret_encrypted,
        active
      FROM binance_accounts
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [
      accountId,
      userId
    ]
  );

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0];
}


// ============================================================
// CLIENT BINANCE
// ============================================================

function createClient(account) {
  const apiKey =
    cryptoService.decrypt(
      account.api_key_encrypted
    );

  const apiSecret =
    cryptoService.decrypt(
      account.api_secret_encrypted
    );

  if (!apiKey || !apiSecret) {
    throw new Error(
      "Credenciais Binance inválidas."
    );
  }

  return Binance({
    apiKey,
    apiSecret
  });
}


// ============================================================
// CONFIGURAÇÃO DO ROBÔ
// ============================================================

async function getConfig(
  userId,
  accountId
) {
  const result = await db.query(
    `
      SELECT *
      FROM robot_configs
      WHERE user_id = $1
        AND account_id = $2
      LIMIT 1
    `,
    [
      userId,
      accountId
    ]
  );

  return result.rows[0] || null;
}


// ============================================================
// CONFIGURAÇÃO PADRÃO
// ============================================================

async function ensureConfig(
  userId,
  accountId
) {
  let config =
    await getConfig(
      userId,
      accountId
    );

  if (config) {
    return config;
  }

  const result =
    await db.query(
      `
        INSERT INTO robot_configs (
          user_id,
          account_id,
          strategy_version,
          entry_percent,
          take_profit_percent,
          stop_loss_percent,
          stop_loss_active,
          max_operations,
          interval,
          max_coins,
          running
        )
        VALUES (
          $1,
          $2,
          'v7.1',
          98,
          5,
          2.5,
          TRUE,
          3,
          '15m',
          20,
          FALSE
        )
        ON CONFLICT (
          user_id,
          account_id
        )
        DO UPDATE SET
          updated_at = NOW()
        RETURNING *
      `,
      [
        userId,
        accountId
      ]
    );

  return result.rows[0];
}


// ============================================================
// SALDO
// ============================================================

async function getBalances(client) {
  const account =
    await client.accountInfo();

  return (
    account.balances || []
  );
}


// ============================================================
// SALDO USDT
// ============================================================

async function getUsdtBalance(
  client
) {
  const balances =
    await getBalances(client);

  const usdt =
    balances.find(
      (item) =>
        item.asset === "USDT"
    );

  return {
    free: number(
      usdt?.free
    ),
    locked: number(
      usdt?.locked
    ),
    total:
      number(usdt?.free) +
      number(usdt?.locked)
  };
}


// ============================================================
// FILTRO DE SÍMBOLO
// ============================================================

function isValidUsdtSymbol(
  symbol
) {
  if (
    !symbol ||
    !symbol.endsWith("USDT")
  ) {
    return false;
  }

  const asset =
    symbol.replace(
      /USDT$/,
      ""
    );

  if (
    STABLE_ASSETS.has(
      asset
    )
  ) {
    return false;
  }

  return true;
}


// ============================================================
// MARKET INFO
// ============================================================

async function getExchangeInfo(
  client
) {
  return client.exchangeInfo();
}


// ============================================================
// FILTROS DA MOEDA
// ============================================================

function getSymbolInfo(
  exchangeInfo,
  symbol
) {
  return (
    exchangeInfo.symbols || []
  ).find(
    (item) =>
      item.symbol === symbol
  );
}


// ============================================================
// PRECISÃO DA QUANTIDADE
// ============================================================

function getLotStep(
  symbolInfo
) {
  const filter =
    (
      symbolInfo?.filters ||
      []
    ).find(
      (item) =>
        item.filterType ===
        "LOT_SIZE"
    );

  return number(
    filter?.stepSize,
    0.000001
  );
}


// ============================================================
// PRECISÃO DO PREÇO
// ============================================================

function getTickSize(
  symbolInfo
) {
  const filter =
    (
      symbolInfo?.filters ||
      []
    ).find(
      (item) =>
        item.filterType ===
        "PRICE_FILTER"
    );

  return number(
    filter?.tickSize,
    0.00000001
  );
}


// ============================================================
// ARREDONDAR QUANTIDADE
// ============================================================

function normalizeQuantity(
  quantity,
  symbolInfo
) {
  const step =
    getLotStep(
      symbolInfo
    );

  if (
    !Number.isFinite(
      quantity
    ) ||
    quantity <= 0
  ) {
    return 0;
  }

  const decimals =
    Math.max(
      0,
      Math.ceil(
        -Math.log10(step)
      )
    );

  const result =
    Math.floor(
      quantity / step
    ) * step;

  return round(
    result,
    decimals
  );
}


// ============================================================
// ARREDONDAR PREÇO
// ============================================================

function normalizePrice(
  price,
  symbolInfo
) {
  const tick =
    getTickSize(
      symbolInfo
    );

  if (
    !Number.isFinite(
      price
    ) ||
    price <= 0
  ) {
    return 0;
  }

  const decimals =
    Math.max(
      0,
      Math.ceil(
        -Math.log10(tick)
      )
    );

  const result =
    Math.round(
      price / tick
    ) * tick;

  return round(
    result,
    decimals
  );
}


// ============================================================
// CANDLES
// ============================================================

async function getCandles(
  client,
  symbol,
  interval,
  limit = 200
) {
  const candles =
    await client.candles({
      symbol,
      interval,
      limit
    });

  return candles || [];
}


// ============================================================
// CONVERSÃO DE CANDLE
// ============================================================

function candleValues(
  candles
) {
  return candles.map(
    (candle) => ({
      open:
        number(candle.open),
      high:
        number(candle.high),
      low:
        number(candle.low),
      close:
        number(candle.close),
      volume:
        number(candle.volume),
      closeTime:
        number(
          candle.closeTime
        )
    })
  );
}


// ============================================================
// EMA
// ============================================================

function calculateEMA(
  values,
  period
) {
  if (
    !values ||
    values.length === 0
  ) {
    return [];
  }

  if (
    values.length < period
  ) {
    return [];
  }

  const multiplier =
    2 / (period + 1);

  const result =
    new Array(
      values.length
    ).fill(null);

  let sum = 0;

  for (
    let i = 0;
    i < period;
    i++
  ) {
    sum += number(
      values[i]
    );
  }

  let ema =
    sum / period;

  result[
    period - 1
  ] = ema;

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    ema =
      (
        (
          number(values[i]) -
          ema
        ) *
        multiplier
      ) + ema;

    result[i] = ema;
  }

  return result;
}


// ============================================================
// RSI
// ============================================================

function calculateRSI(
  values,
  period = 14
) {
  if (
    !values ||
    values.length <= period
  ) {
    return [];
  }

  const result =
    new Array(
      values.length
    ).fill(null);

  let gain = 0;
  let loss = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    const change =
      number(values[i]) -
      number(values[i - 1]);

    if (change >= 0) {
      gain += change;
    } else {
      loss += Math.abs(
        change
      );
    }
  }

  let avgGain =
    gain / period;

  let avgLoss =
    loss / period;

  function rsiValue() {
    if (avgLoss === 0) {
      return 100;
    }

    const rs =
      avgGain / avgLoss;

    return (
      100 -
      100 /
        (1 + rs)
    );
  }

  result[period] =
    rsiValue();

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {
    const change =
      number(values[i]) -
      number(values[i - 1]);

    const currentGain =
      change > 0
        ? change
        : 0;

    const currentLoss =
      change < 0
        ? Math.abs(change)
        : 0;

    avgGain =
      (
        avgGain *
          (period - 1) +
        currentGain
      ) / period;

    avgLoss =
      (
        avgLoss *
          (period - 1) +
        currentLoss
      ) / period;

    result[i] =
      rsiValue();
  }

  return result;
}


// ============================================================
// MÉDIA DE VOLUME
// ============================================================

function average(
  values
) {
  if (
    !values ||
    values.length === 0
  ) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + number(value),
      0
    ) /
    values.length
  );
}


// ============================================================
// TOP MARKET CAP - COINGECKO
// ============================================================

async function getTopMarketCapCoins(
  maxCoins
) {
  try {
    const url =
      "https://api.coingecko.com/api/v3/coins/markets" +
      "?vs_currency=usd" +
      "&order=market_cap_desc" +
      "&per_page=100" +
      "&page=1" +
      "&sparkline=false";

    const response =
      await fetch(
        url,
        {
          headers: {
            "Accept":
              "application/json",
            "User-Agent":
              "CriptoPro/1.0"
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `CoinGecko HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    const result = [];

    for (
      const coin of
      data || []
    ) {
      if (
        !coin.symbol
      ) {
        continue;
      }

      const symbol =
        `${coin.symbol.toUpperCase()}USDT`;

      if (
        !isValidUsdtSymbol(
          symbol
        )
      ) {
        continue;
      }

      result.push({
        symbol,
        marketCapRank:
          number(
            coin.market_cap_rank
          ),
        marketCap:
          number(
            coin.market_cap
          )
      });

      if (
        result.length >=
        maxCoins
      ) {
        break;
      }
    }

    return result;
  } catch (error) {
    console.error(
      "Erro CoinGecko:",
      error.message
    );

    return [];
  }
}


// ============================================================
// TOP VOLUME BINANCE
// ============================================================

async function getTopVolumeCoins(
  client,
  maxCoins
) {
  try {
    const tickers =
      await client.dailyStats();

    const result =
      (tickers || [])
        .filter(
          (ticker) =>
            isValidUsdtSymbol(
              ticker.symbol
            )
        )
        .map(
          (ticker) => ({
            symbol:
              ticker.symbol,
            quoteVolume:
              number(
                ticker.quoteVolume
              ),
            price:
              number(
                ticker.lastPrice
              )
          })
        )
        .sort(
          (a, b) =>
            b.quoteVolume -
            a.quoteVolume
        )
        .slice(
          0,
          maxCoins
        );

    return result;
  } catch (error) {
    console.error(
      "Erro ao buscar TOP volume:",
      error.message
    );

    return [];
  }
}


// ============================================================
// PREÇO ATUAL
// ============================================================

async function getCurrentPrice(
  client,
  symbol
) {
  try {
    const result =
      await client.prices();

    return number(
      result[symbol]
    );
  } catch (error) {
    console.error(
      `Erro preço ${symbol}:`,
      error.message
    );

    return 0;
  }
}


// ============================================================
// FILTRO BTC
// ============================================================
//
// V7.1:
// BTC precisa apresentar estrutura positiva
// no diário e no 4H.
//
// ============================================================

async function btcMarketFilter(
  client
) {
  try {
    const daily =
      candleValues(
        await getCandles(
          client,
          "BTCUSDT",
          "1d",
          100
        )
      );

    const fourHour =
      candleValues(
        await getCandles(
          client,
          "BTCUSDT",
          "4h",
          100
        )
      );

    if (
      daily.length < 30 ||
      fourHour.length < 30
    ) {
      return false;
    }

    const dailyClose =
      daily.map(
        (c) => c.close
      );

    const fourHourClose =
      fourHour.map(
        (c) => c.close
      );

    const dailyEma =
      calculateEMA(
        dailyClose,
        21
      );

    const fourHourEma =
      calculateEMA(
        fourHourClose,
        21
      );

    const lastDaily =
      dailyClose[
        dailyClose.length - 1
      ];

    const lastFourHour =
      fourHourClose[
        fourHourClose.length - 1
      ];

    const emaDaily =
      dailyEma[
        dailyEma.length - 1
      ];

    const emaFourHour =
      fourHourEma[
        fourHourEma.length - 1
      ];

    return (
      lastDaily > emaDaily &&
      lastFourHour > emaFourHour
    );
  } catch (error) {
    console.error(
      "Erro filtro BTC:",
      error.message
    );

    return false;
  }
}


// ============================================================
// SCORE V7.1
// ============================================================

function calculateV71Score(
  candles
) {
  if (
    candles.length < 50
  ) {
    return {
      score: 0,
      details: []
    };
  }

  const values =
    candles.map(
      (c) => c.close
    );

  const ema9 =
    calculateEMA(
      values,
      9
    );

  const ema21 =
    calculateEMA(
      values,
      21
    );

  const rsi =
    calculateRSI(
      values,
      14
    );

  const last =
    candles.length - 1;

  const price =
    values[last];

  const e9 =
    ema9[last];

  const e21 =
    ema21[last];

  const currentRsi =
    rsi[last];

  const previous =
    candles[last - 1];

  const previousE9 =
    ema9[last - 1];

  const previousE21 =
    ema21[last - 1];

  let score = 0;

  const details = [];

  // ==========================================================
  // EMA 9 > EMA 21
  // ==========================================================

  if (
    e9 > e21
  ) {
    score++;

    details.push(
      "EMA9 acima da EMA21"
    );
  }

  // ==========================================================
  // PREÇO > EMA9
  // ==========================================================

  if (
    price > e9
  ) {
    score++;

    details.push(
      "Preço acima da EMA9"
    );
  }

  // ==========================================================
  // CRUZAMENTO / MOMENTO
  // ==========================================================

  if (
    previousE9 <= previousE21 &&
    e9 > e21
  ) {
    score += 2;

    details.push(
      "Cruzamento EMA positivo"
    );
  }

  // ==========================================================
  // RSI
  // ==========================================================

  if (
    currentRsi >= 45 &&
    currentRsi <= 68
  ) {
    score++;

    details.push(
      "RSI em zona favorável"
    );
  }

  // ==========================================================
  // MOMENTO DO CANDLE
  // ==========================================================

  if (
    previous.close >
    previous.open
  ) {
    score++;

    details.push(
      "Último candle positivo"
    );
  }

  // ==========================================================
  // PULLBACK
  // ==========================================================

  const distanceEma =
    Math.abs(
      price - e9
    ) / price;

  if (
    distanceEma <= 0.02
  ) {
    score++;

    details.push(
      "Pullback próximo da EMA9"
    );
  }

  // ==========================================================
  // BREAKOUT
  // ==========================================================

  const previousHighs =
    candles
      .slice(
        Math.max(
          0,
          candles.length - 21
        ),
        candles.length - 1
      )
      .map(
        (c) => c.high
      );

  const highest =
    Math.max(
      ...previousHighs
    );

  if (
    price > highest
  ) {
    score += 2;

    details.push(
      "Breakout da máxima recente"
    );
  }

  // ==========================================================
  // VOLUME
  // ==========================================================

  const volumes =
    candles
      .slice(
        Math.max(
          0,
          candles.length - 21
        ),
        candles.length - 1
      )
      .map(
        (c) => c.volume
      );

  const averageVolume =
    average(
      volumes
    );

  if (
    previous.volume >
    averageVolume
  ) {
    score++;

    details.push(
      "Volume acima da média"
    );
  }

  return {
    score,
    details,
    price,
    ema9: e9,
    ema21: e21,
    rsi: currentRsi
  };
}


// ============================================================
// ESTRATÉGIA V7.1
// ============================================================

async function scanV71(
  client,
  config
) {
  const btcOk =
    await btcMarketFilter(
      client
    );

  if (!btcOk) {
    console.log(
      "[ROBO V7.1] Filtro BTC não aprovado."
    );

    return [];
  }

  const coins =
    await getTopMarketCapCoins(
      config.max_coins
    );

  if (
    !coins.length
  ) {
    return [];
  }

  const opportunities = [];

  for (
    const coin of coins
  ) {
    try {
      const candles =
        candleValues(
          await getCandles(
            client,
            coin.symbol,
            config.interval,
            200
          )
        );

      const analysis =
        calculateV71Score(
          candles
        );

      if (
        analysis.score >= 7
      ) {
        opportunities.push({
          symbol:
            coin.symbol,

          score:
            analysis.score,

          price:
            analysis.price,

          ema9:
            analysis.ema9,

          ema21:
            analysis.ema21,

          rsi:
            analysis.rsi,

          details:
            analysis.details,

          marketCapRank:
            coin.marketCapRank
        });
      }
    } catch (error) {
      console.error(
        `[ROBO V7.1] ${coin.symbol}:`,
        error.message
      );
    }

    await sleep(100);
  }

  opportunities.sort(
    (a, b) =>
      b.score - a.score
  );

  return opportunities;
}


// ============================================================
// ESTRATÉGIA V6
// ============================================================

async function scanV6(
  client,
  config
) {
  const coins =
    await getTopVolumeCoins(
      client,
      config.max_coins
    );

  const opportunities = [];

  for (
    const coin of coins
  ) {
    try {
      const candles =
        candleValues(
          await getCandles(
            client,
            coin.symbol,
            config.interval,
            200
          )
        );

      if (
        candles.length < 50
      ) {
        continue;
      }

      const closes =
        candles.map(
          (c) => c.close
        );

      const ema9 =
        calculateEMA(
          closes,
          9
        );

      const ema21 =
        calculateEMA(
          closes,
          21
        );

      const rsi =
        calculateRSI(
          closes,
          14
        );

      const last =
        candles.length - 1;

      const price =
        closes[last];

      const currentEma9 =
        ema9[last];

      const currentEma21 =
        ema21[last];

      const currentRsi =
        rsi[last];

      const volumes =
        candles
          .slice(
            Math.max(
              0,
              candles.length - 21
            ),
            candles.length - 1
          )
          .map(
            (c) =>
              c.volume
          );

      const avgVolume =
        average(
          volumes
        );

      const currentVolume =
        candles[last].volume;

      let score = 0;

      const details = [];

      if (
        currentEma9 >
        currentEma21
      ) {
        score++;

        details.push(
          "EMA9 acima da EMA21"
        );
      }

      if (
        price >
        currentEma9
      ) {
        score++;

        details.push(
          "Preço acima da EMA9"
        );
      }

      if (
        currentRsi >= 45 &&
        currentRsi <= 60
      ) {
        score++;

        details.push(
          "RSI entre 45 e 60"
        );
      }

      if (
        currentVolume >
        avgVolume
      ) {
        score++;

        details.push(
          "Volume acima da média"
        );
      }

      if (
        score >= 3
      ) {
        opportunities.push({
          symbol:
            coin.symbol,

          score,

          price,

          ema9:
            currentEma9,

          ema21:
            currentEma21,

          rsi:
            currentRsi,

          volume:
            currentVolume,

          averageVolume:
            avgVolume,

          details
        });
      }
    } catch (error) {
      console.error(
        `[ROBO V6] ${coin.symbol}:`,
        error.message
      );
    }

    await sleep(100);
  }

  opportunities.sort(
    (a, b) =>
      b.score - a.score
  );

  return opportunities;
}


// ============================================================
// OPERAÇÕES ABERTAS
// ============================================================

async function getOpenOperations(
  userId,
  accountId
) {
  const result =
    await db.query(
      `
        SELECT *
        FROM robot_operations
        WHERE user_id = $1
          AND account_id = $2
          AND status IN (
            'OPEN',
            'SELL_PENDING'
          )
        ORDER BY id ASC
      `,
      [
        userId,
        accountId
      ]
    );

  return result.rows;
}


// ============================================================
// CONTAGEM DE OPERAÇÕES
// ============================================================

async function countOpenOperations(
  userId,
  accountId
) {
  const result =
    await db.query(
      `
        SELECT COUNT(*)::INTEGER AS total
        FROM robot_operations
        WHERE user_id = $1
          AND account_id = $2
          AND status IN (
            'OPEN',
            'SELL_PENDING'
          )
      `,
      [
        userId,
        accountId
      ]
    );

  return number(
    result.rows[0]?.total
  );
}


// ============================================================
// VERIFICAR ORDEM
// ============================================================

async function getOrder(
  client,
  symbol,
  orderId
) {
  try {
    return await client.getOrder({
      symbol,
      orderId
    });
  } catch (error) {
    console.error(
      `Erro ordem ${symbol}/${orderId}:`,
      error.message
    );

    return null;
  }
}


// ============================================================
// ATUALIZAR OPERAÇÃO
// ============================================================

async function updateOperation(
  operationId,
  fields
) {
  const allowed = [
    "sell_order_id",
    "sell_price",
    "sell_time",
    "pnl_quote",
    "pnl_percent",
    "status",
    "reason",
    "updated_at",
    "metadata"
  ];

  const entries =
    Object.entries(fields)
      .filter(
        ([key]) =>
          allowed.includes(key)
      );

  if (
    !entries.length
  ) {
    return;
  }

  const values = [];
  const assignments = [];

  let index = 1;

  for (
    const [key, value]
    of entries
  ) {
    assignments.push(
      `${key} = $${index}`
    );

    values.push(
      value
    );

    index++;
  }

  values.push(
    operationId
  );

  await db.query(
    `
      UPDATE robot_operations
      SET
        ${assignments.join(", ")},
        updated_at = NOW()
      WHERE id = $${index}
    `,
    values
  );
}


// ============================================================
// REGISTRAR OPERAÇÃO
// ============================================================

async function createOperation(
  data
) {
  const result =
    await db.query(
      `
        INSERT INTO robot_operations (
          user_id,
          account_id,
          symbol,
          strategy_version,
          buy_order_id,
          sell_order_id,
          buy_price,
          quantity,
          invested_quote,
          take_profit_price,
          stop_loss_price,
          status,
          buy_time,
          metadata
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          NULL,
          $6,
          $7,
          $8,
          $9,
          $10,
          'OPEN',
          NOW(),
          $11
        )
        RETURNING *
      `,
      [
        data.userId,
        data.accountId,
        data.symbol,
        data.strategyVersion,
        data.buyOrderId,
        data.buyPrice,
        data.quantity,
        data.investedQuote,
        data.takeProfitPrice,
        data.stopLossPrice,
        JSON.stringify(
          data.metadata || {}
        )
      ]
    );

  return result.rows[0];
}


// ============================================================
// CALCULAR VALOR DE ENTRADA
// ============================================================

async function calculateInvestment(
  client,
  config
) {
  const balance =
    await getUsdtBalance(
      client
    );

  if (
    balance.free <= 0
  ) {
    return 0;
  }

  const percentual =
    clamp(
      number(
        config.entry_percent,
        98
      ),
      0,
      100
    );

  return (
    balance.free *
    (percentual / 100)
  );
}


// ============================================================
// COMPRAR
// ============================================================

async function executeBuy(
  client,
  userId,
  accountId,
  opportunity,
  config,
  exchangeInfo
) {
  const symbol =
    opportunity.symbol;

  const symbolInfo =
    getSymbolInfo(
      exchangeInfo,
      symbol
    );

  if (!symbolInfo) {
    console.log(
      `[ROBO] ${symbol}: símbolo não encontrado.`
    );

    return null;
  }

  const investment =
    await calculateInvestment(
      client,
      config
    );

  if (
    investment <= 0
  ) {
    return null;
  }

  // ==========================================================
  // O robô utiliza MARKET BUY por quoteOrderQty.
  // ==========================================================

  let order;

  try {
    order =
      await client.order({
        symbol,

        side: "BUY",

        type: "MARKET",

        quoteOrderQty:
          round(
            investment,
            2
          )
      });
  } catch (error) {
    console.error(
      `[ROBO] Erro compra ${symbol}:`,
      error.message
    );

    return null;
  }

  if (!order) {
    return null;
  }

  // ==========================================================
  // CALCULAR EXECUÇÃO REAL
  // ==========================================================

  let executedQty =
    number(
      order.executedQty
    );

  let executedQuote =
    number(
      order.cummulativeQuoteQty
    );

  let avgPrice = 0;

  if (
    Array.isArray(
      order.fills
    ) &&
    order.fills.length
  ) {
    let qty = 0;
    let quote = 0;

    for (
      const fill of
      order.fills
    ) {
      const fillQty =
        number(
          fill.qty
        );

      const fillPrice =
        number(
          fill.price
        );

      qty +=
        fillQty;

      quote +=
        fillQty *
        fillPrice;
    }

    if (
      qty > 0
    ) {
      executedQty =
        qty;

      executedQuote =
        quote;
    }
  }

  if (
    executedQty <= 0
  ) {
    console.error(
      `[ROBO] Compra ${symbol} sem quantidade executada.`
    );

    return null;
  }

  avgPrice =
    executedQuote /
    executedQty;

  avgPrice =
    normalizePrice(
      avgPrice,
      symbolInfo
    );

  executedQty =
    normalizeQuantity(
      executedQty,
      symbolInfo
    );

  if (
    executedQty <= 0
  ) {
    return null;
  }

  // ==========================================================
  // TAKE PROFIT
  // ==========================================================

  const tpPercent =
    number(
      config.take_profit_percent,
      5
    );

  const slPercent =
    number(
      config.stop_loss_percent,
      2.5
    );

  const takeProfitPrice =
    normalizePrice(
      avgPrice *
        (
          1 +
          tpPercent / 100
        ),
      symbolInfo
    );

  const stopLossPrice =
    normalizePrice(
      avgPrice *
        (
          1 -
          slPercent / 100
        ),
      symbolInfo
    );

  // ==========================================================
  // CRIAR SELL LIMIT
  // ==========================================================

  let sellOrder;

  try {
    sellOrder =
      await client.order({
        symbol,

        side: "SELL",

        type: "LIMIT",

        quantity:
          executedQty,

        price:
          takeProfitPrice,

        timeInForce:
          "GTC"
      });
  } catch (error) {
    console.error(
      `[ROBO] Erro ao criar TP ${symbol}:`,
      error.message
    );

    // ========================================================
    // SEGURANÇA:
    // Se comprou mas não conseguiu criar o TP,
    // tenta vender a mercado.
    // ========================================================

    try {
      await client.order({
        symbol,

        side: "SELL",

        type: "MARKET",

        quantity:
          executedQty
      });

      console.log(
        `[ROBO] ${symbol}: posição fechada a mercado após falha no TP.`
      );
    } catch (sellError) {
      console.error(
        `[ROBO] ERRO CRÍTICO ao fechar ${symbol}:`,
        sellError.message
      );
    }

    return null;
  }

  const operation =
    await createOperation({
      userId,

      accountId,

      symbol,

      strategyVersion:
        config.strategy_version,

      buyOrderId:
        String(
          order.orderId
        ),

      buyPrice:
        avgPrice,

      quantity:
        executedQty,

      investedQuote:
        executedQuote,

      takeProfitPrice,

      stopLossPrice,

      metadata: {
        score:
          opportunity.score,

        rsi:
          opportunity.rsi,

        ema9:
          opportunity.ema9,

        ema21:
          opportunity.ema21,

        details:
          opportunity.details || []
      }
    });

  console.log(
    `[ROBO] COMPRA EXECUTADA ${symbol}`,
    {
      operationId:
        operation.id,

      quantity:
        executedQty,

      price:
        avgPrice,

      takeProfit:
        takeProfitPrice,

      stopLoss:
        stopLossPrice
    }
  );

  return operation;
}


// ============================================================
// FECHAR OPERAÇÃO
// ============================================================

async function closeOperationMarket(
  client,
  operation,
  reason,
  symbolInfo
) {
  const symbol =
    operation.symbol;

  // ==========================================================
  // CANCELAR TP
  // ==========================================================

  if (
    operation.sell_order_id
  ) {
    try {
      await client.cancelOrder({
        symbol,

        orderId:
          operation.sell_order_id
      });
    } catch (error) {
      // Pode já ter sido executada.
      console.log(
        `[ROBO] Não foi possível cancelar TP ${symbol}:`,
        error.message
      );
    }
  }

  // ==========================================================
  // CONSULTAR SALDO REAL
  // ==========================================================

  let quantity =
    number(
      operation.quantity
    );

  try {
    const balances =
      await getBalances(
        client
      );

    const asset =
      symbol.replace(
        /USDT$/,
        ""
      );

    const balance =
      balances.find(
        (item) =>
          item.asset === asset
      );

    if (balance) {
      const available =
        number(
          balance.free
        );

      if (
        available > 0
      ) {
        quantity =
          Math.min(
            quantity,
            available
          );
      }
    }
  } catch (error) {
    console.error(
      `[ROBO] Erro ao consultar saldo ${symbol}:`,
      error.message
    );
  }

  quantity =
    normalizeQuantity(
      quantity,
      symbolInfo
    );

  if (
    quantity <= 0
  ) {
    await updateOperation(
      operation.id,
      {
        status:
          "CLOSED",

        reason,

        sell_time:
          new Date()
      }
    );

    return null;
  }

  // ==========================================================
  // VENDA A MERCADO
  // ==========================================================

  let sellOrder;

  try {
    sellOrder =
      await client.order({
        symbol,

        side: "SELL",

        type: "MARKET",

        quantity
      });
  } catch (error) {
    console.error(
      `[ROBO] ERRO AO VENDER ${symbol}:`,
      error.message
    );

    return null;
  }

  let sellQty =
    number(
      sellOrder.executedQty
    );

  let sellQuote =
    number(
      sellOrder.cummulativeQuoteQty
    );

  if (
    Array.isArray(
      sellOrder.fills
    ) &&
    sellOrder.fills.length
  ) {
    let qty = 0;
    let quote = 0;

    for (
      const fill of
      sellOrder.fills
    ) {
      const q =
        number(
          fill.qty
        );

      const p =
        number(
          fill.price
        );

      qty += q;
      quote +=
        q * p;
    }

    if (
      qty > 0
    ) {
      sellQty =
        qty;

      sellQuote =
        quote;
    }
  }

  const sellPrice =
    sellQty > 0
      ? sellQuote /
        sellQty
      : 0;

  const buyValue =
    number(
      operation.invested_quote
    );

  const pnl =
    sellQuote -
    buyValue;

  const pnlPercent =
    buyValue > 0
      ? (
          pnl /
          buyValue
        ) * 100
      : 0;

  await updateOperation(
    operation.id,
    {
      status:
        "CLOSED",

      sell_order_id:
        String(
          sellOrder.orderId
        ),

      sell_price:
        sellPrice,

      sell_time:
        new Date(),

      pnl_quote:
        pnl,

      pnl_percent:
        pnlPercent,

      reason
    }
  );

  console.log(
    `[ROBO] OPERAÇÃO ENCERRADA ${symbol}`,
    {
      reason,
      sellPrice,
      pnl,
      pnlPercent
    }
  );

  return sellOrder;
}


// ============================================================
// MONITORAR OPERAÇÕES
// ============================================================

async function monitorOperations(
  runner
) {
  const {
    userId,
    accountId,
    client,
    config,
    exchangeInfo
  } = runner;

  const operations =
    await getOpenOperations(
      userId,
      accountId
    );

  for (
    const operation of
    operations
  ) {
    try {
      const symbolInfo =
        getSymbolInfo(
          exchangeInfo,
          operation.symbol
        );

      if (!symbolInfo) {
        continue;
      }

      // ========================================================
      // VERIFICAR TP
      // ========================================================

      if (
        operation.sell_order_id
      ) {
        const order =
          await getOrder(
            client,
            operation.symbol,
            operation.sell_order_id
          );

        if (
          order &&
          (
            order.status ===
              "FILLED"
          )
        ) {
          const sellPrice =
            number(
              order.avgPrice ||
              order.price
            );

          const buyValue =
            number(
              operation.invested_quote
            );

          const sellQuote =
            number(
              order.cummulativeQuoteQty
            );

          const pnl =
            sellQuote -
            buyValue;

          const pnlPercent =
            buyValue > 0
              ? (
                  pnl /
                  buyValue
                ) * 100
              : 0;

          await updateOperation(
            operation.id,
            {
              status:
                "CLOSED",

              sell_price:
                sellPrice,

              sell_time:
                new Date(),

              pnl_quote:
                pnl,

              pnl_percent:
                pnlPercent,

              reason:
                "TAKE_PROFIT"
            }
          );

          console.log(
            `[ROBO] TAKE PROFIT ${operation.symbol}`,
            {
              pnl,
              pnlPercent
            }
          );

          continue;
        }

        // ======================================================
        // TP CANCELADO / REJEITADO
        // ======================================================

        if (
          order &&
          (
            order.status ===
              "CANCELED" ||
            order.status ===
              "REJECTED" ||
            order.status ===
              "EXPIRED"
          )
        ) {
          await updateOperation(
            operation.id,
            {
              status:
                "OPEN",

              sell_order_id:
                null
            }
          );

          continue;
        }
      }

      // ========================================================
      // STOP LOSS
      // ========================================================

      if (
        Boolean(
          config.stop_loss_active
        )
      ) {
        const currentPrice =
          await getCurrentPrice(
            client,
            operation.symbol
          );

        const stopPrice =
          number(
            operation.stop_loss_price
          );

        if (
          currentPrice > 0 &&
          stopPrice > 0 &&
          currentPrice <=
            stopPrice
        ) {
          console.log(
            `[ROBO] STOP LOSS ${operation.symbol}`
          );

          await closeOperationMarket(
            client,
            operation,
            "STOP_LOSS",
            symbolInfo
          );
        }
      }
    } catch (error) {
      console.error(
        `[ROBO] Erro monitorando ${operation.symbol}:`,
        error.message
      );
    }
  }
}


// ============================================================
// EXECUTAR NOVA VARREDURA
// ============================================================

async function scanAndOperate(
  runner
) {
  const {
    userId,
    accountId,
    client,
    config,
    exchangeInfo
  } = runner;

  // ==========================================================
  // VERIFICAR CONFIGURAÇÃO
  // ==========================================================

  if (
    !config.running
  ) {
    return;
  }

  // ==========================================================
  // LIMITE DE OPERAÇÕES
  // ==========================================================

  const openCount =
    await countOpenOperations(
      userId,
      accountId
    );

  if (
    openCount >=
    Number(
      config.max_operations
    )
  ) {
    console.log(
      `[ROBO] Limite de operações atingido: ${openCount}/${config.max_operations}`
    );

    return;
  }

  // ==========================================================
  // ESCOLHER ESTRATÉGIA
  // ==========================================================

  let opportunities = [];

  if (
    config.strategy_version ===
    "v6"
  ) {
    opportunities =
      await scanV6(
        client,
        config
      );
  } else {
    opportunities =
      await scanV71(
        client,
        config
      );
  }

  if (
    !opportunities.length
  ) {
    console.log(
      "[ROBO] Nenhuma oportunidade encontrada."
    );

    return;
  }

  // ==========================================================
  // EVITAR MOEDA JÁ ABERTA
  // ==========================================================

  const openOperations =
    await getOpenOperations(
      userId,
      accountId
    );

  const openedSymbols =
    new Set(
      openOperations.map(
        (operation) =>
          operation.symbol
      )
    );

  // ==========================================================
  // ABRIR OPERAÇÕES
  // ==========================================================

  for (
    const opportunity
    of opportunities
  ) {
    const currentCount =
      await countOpenOperations(
        userId,
        accountId
      );

    if (
      currentCount >=
      Number(
        config.max_operations
      )
    ) {
      break;
    }

    if (
      openedSymbols.has(
        opportunity.symbol
      )
    ) {
      continue;
    }

    await executeBuy(
      client,
      userId,
      accountId,
      opportunity,
      config,
      exchangeInfo
    );

    // ========================================================
    // UMA OPERAÇÃO POR CICLO POR SEGURANÇA
    // ========================================================

    break;
  }
}


// ============================================================
// RUNNER
// ============================================================

async function createRunner(
  userId,
  accountId
) {
  const key =
    runnerKey(
      userId,
      accountId
    );

  if (
    RUNNERS.has(key)
  ) {
    return RUNNERS.get(key);
  }

  const account =
    await getAccount(
      userId,
      accountId
    );

  if (!account) {
    throw new Error(
      "Conta Binance não encontrada."
    );
  }

  if (
    !account.active
  ) {
    throw new Error(
      "Conta Binance desativada."
    );
  }

  const config =
    await ensureConfig(
      userId,
      accountId
    );

  const client =
    createClient(
      account
    );

  const exchangeInfo =
    await getExchangeInfo(
      client
    );

  const runner = {
    userId,
    accountId,

    account,

    client,

    exchangeInfo,

    config,

    timer: null,

    busy: false,

    stopped: false,

    lastScanAt: null,

    lastError: null
  };

  RUNNERS.set(
    key,
    runner
  );

  return runner;
}


// ============================================================
// CICLO
// ============================================================

async function cycle(
  runner
) {
  if (
    runner.stopped
  ) {
    return;
  }

  if (
    runner.busy
  ) {
    return;
  }

  runner.busy = true;

  try {
    // ========================================================
    // ATUALIZAR CONFIGURAÇÃO
    // ========================================================

    const freshConfig =
      await getConfig(
        runner.userId,
        runner.accountId
      );

    if (
      !freshConfig ||
      !freshConfig.running
    ) {
      await stopRunner(
        runner.userId,
        runner.accountId,
        false
      );

      return;
    }

    runner.config =
      freshConfig;

    // ========================================================
    // MONITORAR OPERAÇÕES
    // ========================================================

    await monitorOperations(
      runner
    );

    // ========================================================
    // SCAN
    // ========================================================

    const now =
      Date.now();

    const scanInterval =
      intervalToMilliseconds(
        runner.config.interval
      );

    const lastScan =
      runner.lastScanAt || 0;

    if (
      now - lastScan >=
      scanInterval
    ) {
      runner.lastScanAt =
        now;

      await scanAndOperate(
        runner
      );
    }

    runner.lastError =
      null;
  } catch (error) {
    runner.lastError =
      error.message;

    console.error(
      `[ROBO ${runner.userId}/${runner.accountId}]`,
      error
    );
  } finally {
    runner.busy =
      false;
  }
}


// ============================================================
// INICIAR RUNNER
// ============================================================

async function startRunner(
  userId,
  accountId
) {
  const runner =
    await createRunner(
      userId,
      accountId
    );

  runner.stopped =
    false;

  // ==========================================================
  // EXECUTAR IMEDIATAMENTE
  // ==========================================================

  await cycle(
    runner
  );

  if (
    !runner.timer
  ) {
    runner.timer =
      setInterval(
        () => {
          cycle(
            runner
          ).catch(
            (error) => {
              console.error(
                "[ROBO] Erro no ciclo:",
                error.message
              );
            }
          );
        },
        RUNNER_INTERVAL_MS
      );
  }

  console.log(
    `[ROBO] Runner iniciado ${userId}/${accountId}`
  );

  return runner;
}


// ============================================================
// PARAR RUNNER
// ============================================================

async function stopRunner(
  userId,
  accountId,
  updateDatabase = true
) {
  const key =
    runnerKey(
      userId,
      accountId
    );

  const runner =
    RUNNERS.get(key);

  if (
    runner
  ) {
    runner.stopped =
      true;

    if (
      runner.timer
    ) {
      clearInterval(
        runner.timer
      );

      runner.timer =
        null;
    }

    RUNNERS.delete(
      key
    );

    console.log(
      `[ROBO] Runner parado ${userId}/${accountId}`
    );
  }

  if (
    updateDatabase
  ) {
    await db.query(
      `
        UPDATE robot_configs
        SET
          running = FALSE,
          updated_at = NOW()
        WHERE user_id = $1
          AND account_id = $2
      `,
      [
        userId,
        accountId
      ]
    );
  }
}


// ============================================================
// START PÚBLICO
// ============================================================

async function start(
  userId,
  accountId
) {
  await ensureTables();

  const account =
    await getAccount(
      userId,
      accountId
    );

  if (!account) {
    throw new Error(
      "Conta Binance não encontrada."
    );
  }

  if (
    !account.active
  ) {
    throw new Error(
      "Conta Binance desativada."
    );
  }

  await ensureConfig(
    userId,
    accountId
  );

  await db.query(
    `
      UPDATE robot_configs
      SET
        running = TRUE,
        updated_at = NOW()
      WHERE user_id = $1
        AND account_id = $2
    `,
    [
      userId,
      accountId
    ]
  );

  return startRunner(
    userId,
    accountId
  );
}


// ============================================================
// STOP PÚBLICO
// ============================================================

async function stop(
  userId,
  accountId
) {
  await ensureTables();

  await stopRunner(
    userId,
    accountId,
    true
  );

  return {
    success: true
  };
}


// ============================================================
// STATUS DO RUNNER
// ============================================================

function getRunnerStatus(
  userId,
  accountId
) {
  const key =
    runnerKey(
      userId,
      accountId
    );

  const runner =
    RUNNERS.get(key);

  if (!runner) {
    return {
      running: false,
      activeRunner: false
    };
  }

  return {
    running:
      !runner.stopped,

    activeRunner:
      true,

    busy:
      Boolean(
        runner.busy
      ),

    lastScanAt:
      runner.lastScanAt
        ? new Date(
            runner.lastScanAt
          ).toISOString()
        : null,

    lastError:
      runner.lastError
  };
}


// ============================================================
// RESUMIR ROBÔS APÓS RESTART
// ============================================================

async function resumeRunning() {
  await ensureTables();

  const result =
    await db.query(
      `
        SELECT
          user_id,
          account_id
        FROM robot_configs
        WHERE running = TRUE
      `
    );

  console.log(
    `[ROBO] ${result.rows.length} robô(s) marcado(s) como ativo(s).`
  );

  for (
    const row of
    result.rows
  ) {
    const userId =
      Number(
        row.user_id
      );

    const accountId =
      Number(
        row.account_id
      );

    try {
      await startRunner(
        userId,
        accountId
      );

      console.log(
        `[ROBO] Robô recuperado ${userId}/${accountId}`
      );
    } catch (error) {
      console.error(
        `[ROBO] Erro recuperando ${userId}/${accountId}:`,
        error.message
      );

      // ========================================================
      // Se não conseguir iniciar, não deixa o banco
      // permanentemente marcado como ativo.
      // ========================================================

      await db.query(
        `
          UPDATE robot_configs
          SET
            running = FALSE,
            updated_at = NOW()
          WHERE user_id = $1
            AND account_id = $2
        `,
        [
          userId,
          accountId
        ]
      );
    }
  }
}


// ============================================================
// STATUS GERAL
// ============================================================

async function getStatus(
  userId,
  accountId
) {
  await ensureTables();

  const config =
    await getConfig(
      userId,
      accountId
    );

  const runnerStatus =
    getRunnerStatus(
      userId,
      accountId
    );

  const operations =
    await getOpenOperations(
      userId,
      accountId
    );

  return {
    config,

    runner:
      runnerStatus,

    openOperations:
      operations.map(
        (operation) => ({
          id:
            operation.id,

          symbol:
            operation.symbol,

          strategy:
            operation.strategy_version,

          buyPrice:
            number(
              operation.buy_price
            ),

          quantity:
            number(
              operation.quantity
            ),

          invested:
            number(
              operation.invested_quote
            ),

          takeProfit:
            number(
              operation.take_profit_price
            ),

          stopLoss:
            number(
              operation.stop_loss_price
            ),

          status:
            operation.status,

          buyTime:
            operation.buy_time,

          sellOrderId:
            operation.sell_order_id
        })
      )
  };
}


// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown() {
  console.log(
    "[ROBO] Encerrando runners..."
  );

  const keys =
    Array.from(
      RUNNERS.keys()
    );

  for (
    const key of keys
  ) {
    const runner =
      RUNNERS.get(key);

    if (!runner) {
      continue;
    }

    if (
      runner.timer
    ) {
      clearInterval(
        runner.timer
      );

      runner.timer =
        null;
    }

    runner.stopped =
      true;
  }

  RUNNERS.clear();

  console.log(
    "[ROBO] Runners encerrados."
  );
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  ensureTables,

  start,

  stop,

  startRunner,

  stopRunner,

  resumeRunning,

  getStatus,

  getRunnerStatus,

  getOpenOperations,

  shutdown
};
