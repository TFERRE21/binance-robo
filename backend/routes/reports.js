const express = require("express");
const Binance = require("binance-api-node").default;

const router = express.Router();

const authMiddleware = require("../middleware/auth");
const cryptoService = require("../services/cryptoService");
const db = require("../services/db");

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function parseDate(value, fallback) {
  if (!value) return fallback;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date;
}

function formatNumber(value, decimals = 8) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Number(number.toFixed(decimals));
}

function chunkArray(array, size) {
  const result = [];

  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }

  return result;
}

function normalizeTrade(trade, symbol) {
  const qty = Number(trade.qty || 0);
  const price = Number(trade.price || 0);
  const quoteQty = Number(
    trade.quoteQty !== undefined
      ? trade.quoteQty
      : qty * price
  );

  const commission = Number(trade.commission || 0);

  return {
    id: String(trade.id || ""),
    orderId: String(trade.orderId || ""),
    symbol,
    side: trade.isBuyer ? "BUY" : "SELL",
    price: formatNumber(price),
    quantity: formatNumber(qty),
    quoteQty: formatNumber(quoteQty, 2),
    commission: formatNumber(commission),
    commissionAsset: trade.commissionAsset || "",
    time: trade.time
      ? new Date(trade.time).toISOString()
      : null,
    isBuyer: Boolean(trade.isBuyer),
    isMaker: Boolean(trade.isMaker)
  };
}

// ============================================================
// BUSCA CONTA DO USUÁRIO
// ============================================================

async function obterContaUsuario(userId, accountId) {
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
    [accountId, userId]
  );

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0];
}

// ============================================================
// CRIA CLIENTE BINANCE
// ============================================================

function criarClienteBinance(conta) {
  const apiKey = cryptoService.decrypt(
    conta.api_key_encrypted
  );

  const apiSecret = cryptoService.decrypt(
    conta.api_secret_encrypted
  );

  if (!apiKey || !apiSecret) {
    throw new Error("Credenciais Binance inválidas.");
  }

  return Binance({
    apiKey,
    apiSecret
  });
}

// ============================================================
// DESCOBRIR SÍMBOLOS RELEVANTES
// ============================================================

async function descobrirSimbolos(client) {
  const symbols = new Set();

  try {
    const account = await client.accountInfo();

    for (const balance of account.balances || []) {
      const free = Number(balance.free || 0);
      const locked = Number(balance.locked || 0);

      if (free === 0 && locked === 0) {
        continue;
      }

      const asset = balance.asset;

      if (!asset) {
        continue;
      }

      // Ignora stablecoins para descoberta inicial.
      if (
        [
          "USDT",
          "USDC",
          "FDUSD",
          "BUSD",
          "TUSD",
          "USDP",
          "DAI"
        ].includes(asset)
      ) {
        continue;
      }

      symbols.add(`${asset}USDT`);
    }
  } catch (error) {
    console.error(
      "Erro ao consultar saldos Binance:",
      error.message
    );
  }

  // ==========================================================
  // ORDENS ABERTAS
  // ==========================================================

  try {
    const openOrders = await client.openOrders();

    for (const order of openOrders || []) {
      if (order.symbol) {
        symbols.add(order.symbol);
      }
    }
  } catch (error) {
    console.error(
      "Erro ao consultar ordens abertas:",
      error.message
    );
  }

  return Array.from(symbols);
}

// ============================================================
// BUSCAR TRADES EM INTERVALOS
// ============================================================

async function buscarTradesPeriodo(
  client,
  symbol,
  startTime,
  endTime
) {
  const trades = [];

  // Binance limita o período por consulta.
  // Usamos blocos menores que 24 horas.
  const DAY = 23 * 60 * 60 * 1000;

  let cursor = startTime;

  while (cursor < endTime) {
    const chunkEnd = Math.min(
      cursor + DAY,
      endTime
    );

    try {
      const result = await client.myTrades({
        symbol,
        startTime: cursor,
        endTime: chunkEnd,
        limit: 1000
      });

      if (Array.isArray(result)) {
        trades.push(...result);
      }
    } catch (error) {
      console.error(
        `Erro ao buscar trades ${symbol}:`,
        error.message
      );
    }

    cursor = chunkEnd + 1;
  }

  return trades;
}

// ============================================================
// GET /api/panel/report
// ============================================================

router.get("/", authMiddleware, async (req, res) => {
  try {
    const accountId = req.query.account;

    if (!accountId) {
      return res.status(400).json({
        error: "Conta Binance não informada."
      });
    }

    const now = new Date();

    const defaultStart = new Date(
      now.getTime() - 7 * 24 * 60 * 60 * 1000
    );

    const startDate = parseDate(
      req.query.start,
      defaultStart
    );

    const endDate = parseDate(
      req.query.end,
      now
    );

    if (startDate >= endDate) {
      return res.status(400).json({
        error: "Período inválido."
      });
    }

    // Limite máximo de 90 dias.
    const maxPeriod =
      90 * 24 * 60 * 60 * 1000;

    if (
      endDate.getTime() - startDate.getTime() >
      maxPeriod
    ) {
      return res.status(400).json({
        error:
          "O período máximo do relatório é de 90 dias."
      });
    }

    const conta = await obterContaUsuario(
      req.user.id,
      accountId
    );

    if (!conta) {
      return res.status(404).json({
        error:
          "Conta Binance não encontrada ou não pertence ao usuário."
      });
    }

    if (!conta.active) {
      return res.status(400).json({
        error: "A conta Binance está desativada."
      });
    }

    const client = criarClienteBinance(conta);

    const symbols =
      await descobrirSimbolos(client);

    const trades = [];

    // ==========================================================
    // BUSCAR TRADES
    // ==========================================================

    for (const symbol of symbols) {
      const symbolTrades =
        await buscarTradesPeriodo(
          client,
          symbol,
          startDate.getTime(),
          endDate.getTime()
        );

      for (const trade of symbolTrades) {
        trades.push(
          normalizeTrade(trade, symbol)
        );
      }
    }

    // ==========================================================
    // REMOVER DUPLICADOS
    // ==========================================================

    const uniqueTrades = [];
    const seen = new Set();

    for (const trade of trades) {
      const key =
        `${trade.symbol}-${trade.id}-${trade.orderId}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      uniqueTrades.push(trade);
    }

    // ==========================================================
    // ORDENAR POR DATA
    // ==========================================================

    uniqueTrades.sort(
      (a, b) =>
        new Date(a.time).getTime() -
        new Date(b.time).getTime()
    );

    // ==========================================================
    // RESUMO
    // ==========================================================

    let totalCompras = 0;
    let totalVendas = 0;

    let quantidadeComprada = 0;
    let quantidadeVendida = 0;

    for (const trade of uniqueTrades) {
      if (trade.side === "BUY") {
        totalCompras += trade.quoteQty;
        quantidadeComprada += trade.quantity;
      } else {
        totalVendas += trade.quoteQty;
        quantidadeVendida += trade.quantity;
      }
    }

    const fluxoBruto =
      totalVendas - totalCompras;

    const resultadoPercentual =
      totalCompras > 0
        ? (fluxoBruto / totalCompras) * 100
        : 0;

    return res.json({
      success: true,

      account: {
        id: conta.id,
        name: conta.name
      },

      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },

      summary: {
        trades: uniqueTrades.length,

        compras: formatNumber(
          totalCompras,
          2
        ),

        vendas: formatNumber(
          totalVendas,
          2
        ),

        fluxoBruto: formatNumber(
          fluxoBruto,
          2
        ),

        resultadoPercentual:
          formatNumber(
            resultadoPercentual,
            2
          ),

        quantidadeComprada:
          formatNumber(
            quantidadeComprada
          ),

        quantidadeVendida:
          formatNumber(
            quantidadeVendida
          )
      },

      trades: uniqueTrades
    });
  } catch (error) {
    console.error(
      "ERRO AO GERAR RELATÓRIO:",
      error
    );

    return res.status(500).json({
      error:
        "Erro ao processar solicitação.",
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined
    });
  }
});

// ============================================================
// GET /api/panel/report/activity
// ============================================================

router.get(
  "/activity",
  authMiddleware,
  async (req, res) => {
    try {
      const accountId =
        req.query.account;

      const days = Math.min(
        Math.max(
          Number(req.query.days || 7),
          1
        ),
        30
      );

      if (!accountId) {
        return res.status(400).json({
          error:
            "Conta Binance não informada."
        });
      }

      const conta =
        await obterContaUsuario(
          req.user.id,
          accountId
        );

      if (!conta) {
        return res.status(404).json({
          error:
            "Conta Binance não encontrada."
        });
      }

      const client =
        criarClienteBinance(conta);

      const endDate = new Date();

      const startDate =
        new Date(
          endDate.getTime() -
          days *
            24 *
            60 *
            60 *
            1000
        );

      const symbols =
        await descobrirSimbolos(client);

      const trades = [];

      for (const symbol of symbols) {
        const symbolTrades =
          await buscarTradesPeriodo(
            client,
            symbol,
            startDate.getTime(),
            endDate.getTime()
          );

        for (const trade of symbolTrades) {
          trades.push(
            normalizeTrade(
              trade,
              symbol
            )
          );
        }
      }

      // ========================================================
      // DEDUPLICAÇÃO
      // ========================================================

      const uniqueTrades = [];

      const seen = new Set();

      for (const trade of trades) {
        const key =
          `${trade.symbol}-${trade.id}-${trade.orderId}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        uniqueTrades.push(trade);
      }

      uniqueTrades.sort(
        (a, b) =>
          new Date(b.time).getTime() -
          new Date(a.time).getTime()
      );

      // ========================================================
      // ATIVIDADE
      // ========================================================

      const activity =
        uniqueTrades.map(
          (trade) => ({
            type:
              trade.side === "BUY"
                ? "BUY"
                : "SELL",

            symbol:
              trade.symbol,

            side:
              trade.side,

            price:
              trade.price,

            quantity:
              trade.quantity,

            value:
              trade.quoteQty,

            time:
              trade.time,

            orderId:
              trade.orderId
          })
        );

      return res.json({
        success: true,

        account: {
          id: conta.id,
          name: conta.name
        },

        period: {
          start:
            startDate.toISOString(),

          end:
            endDate.toISOString()
        },

        total:
          activity.length,

        activity
      });
    } catch (error) {
      console.error(
        "ERRO AO CONSULTAR ATIVIDADE:",
        error
      );

      return res.status(500).json({
        error:
          "Erro ao consultar atividade."
      });
    }
  }
);

// ============================================================
// GET /api/panel/report/trade-info
// ============================================================

router.get(
  "/trade-info",
  authMiddleware,
  async (req, res) => {
    try {
      const accountId =
        req.query.account;

      const symbol =
        String(
          req.query.symbol || ""
        ).toUpperCase();

      const orderId =
        req.query.orderId;

      if (!accountId) {
        return res.status(400).json({
          error:
            "Conta Binance não informada."
        });
      }

      if (!symbol) {
        return res.status(400).json({
          error:
            "Símbolo não informado."
        });
      }

      const conta =
        await obterContaUsuario(
          req.user.id,
          accountId
        );

      if (!conta) {
        return res.status(404).json({
          error:
            "Conta Binance não encontrada."
        });
      }

      const client =
        criarClienteBinance(conta);

      const trades =
        await client.myTrades({
          symbol,
          limit: 1000
        });

      let filtered =
        Array.isArray(trades)
          ? trades
          : [];

      if (orderId) {
        filtered =
          filtered.filter(
            (trade) =>
              String(
                trade.orderId
              ) ===
              String(orderId)
          );
      }

      filtered =
        filtered.map(
          (trade) =>
            normalizeTrade(
              trade,
              symbol
            )
        );

      filtered.sort(
        (a, b) =>
          new Date(b.time).getTime() -
          new Date(a.time).getTime()
      );

      return res.json({
        success: true,

        account: {
          id: conta.id,
          name: conta.name
        },

        symbol,

        orderId:
          orderId || null,

        trades:
          filtered
      });
    } catch (error) {
      console.error(
        "ERRO AO CONSULTAR TRADE:",
        error
      );

      return res.status(500).json({
        error:
          "Erro ao consultar detalhes da operação."
      });
    }
  }
);

module.exports = router;
