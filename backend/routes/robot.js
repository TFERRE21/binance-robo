const express = require("express");

const router = express.Router();

const authMiddleware = require("../middleware/auth");
const db = require("../database");

// ============================================================
// CONFIGURAÇÕES PERMITIDAS
// ============================================================

const STRATEGIES = [
  "v7.1",
  "v6"
];

const INTERVALS = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h"
];

// ============================================================
// HELPERS
// ============================================================

function numberValue(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : NaN;
}

function booleanValue(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (
    value === true ||
    value === "true" ||
    value === 1 ||
    value === "1"
  ) {
    return true;
  }

  if (
    value === false ||
    value === "false" ||
    value === 0 ||
    value === "0"
  ) {
    return false;
  }

  return null;
}

// ============================================================
// GARANTIR TABELAS DO ROBÔ
// ============================================================

async function ensureRobotTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS robot_configs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      strategy_version VARCHAR(20) NOT NULL DEFAULT 'v7.1',
      entry_percent NUMERIC(10,4) NOT NULL DEFAULT 98,
      take_profit_percent NUMERIC(10,4) NOT NULL DEFAULT 5,
      stop_loss_percent NUMERIC(10,4) NOT NULL DEFAULT 2.5,
      stop_loss_active BOOLEAN NOT NULL DEFAULT TRUE,
      max_operations INTEGER NOT NULL DEFAULT 3,
      interval VARCHAR(10) NOT NULL DEFAULT '15m',
      max_coins INTEGER NOT NULL DEFAULT 20,
      running BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, account_id)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_robot_configs_user_account
    ON robot_configs(user_id, account_id)
  `);
}

// ============================================================
// VALIDAR CONTA DO USUÁRIO
// ============================================================

async function getUserAccount(
  userId,
  accountId
) {
  const result = await db.query(
    `
      SELECT
        id,
        user_id,
        name,
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
// BUSCAR CONFIGURAÇÃO
// ============================================================

async function getRobotConfig(
  userId,
  accountId
) {
  const result = await db.query(
    `
      SELECT
        id,
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
        running,
        created_at,
        updated_at
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

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0];
}

// ============================================================
// CRIAR CONFIGURAÇÃO PADRÃO
// ============================================================

async function createDefaultConfig(
  userId,
  accountId
) {
  const result = await db.query(
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
        running,
        created_at,
        updated_at
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
        FALSE,
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id, account_id)
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
// FORMATAR CONFIGURAÇÃO
// ============================================================

function formatConfig(config) {
  if (!config) {
    return null;
  }

  return {
    id: config.id,

    userId:
      Number(config.user_id),

    accountId:
      Number(config.account_id),

    strategyVersion:
      config.strategy_version,

    entryPercent:
      Number(config.entry_percent),

    takeProfitPercent:
      Number(config.take_profit_percent),

    stopLossPercent:
      Number(config.stop_loss_percent),

    stopLossActive:
      Boolean(config.stop_loss_active),

    maxOperations:
      Number(config.max_operations),

    interval:
      config.interval,

    maxCoins:
      Number(config.max_coins),

    running:
      Boolean(config.running),

    createdAt:
      config.created_at,

    updatedAt:
      config.updated_at
  };
}

// ============================================================
// GET /api/robot/status
// ============================================================

router.get(
  "/status",
  authMiddleware,
  async (req, res) => {
    try {
      await ensureRobotTables();

      const accountId =
        Number(req.query.account);

      if (
        !Number.isInteger(
          accountId
        ) ||
        accountId <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Conta Binance não informada."
        });
      }

      const account =
        await getUserAccount(
          req.user.id,
          accountId
        );

      if (!account) {
        return res.status(404).json({
          success: false,
          error:
            "Conta Binance não encontrada ou não pertence ao usuário."
        });
      }

      let config =
        await getRobotConfig(
          req.user.id,
          accountId
        );

      if (!config) {
        config =
          await createDefaultConfig(
            req.user.id,
            accountId
          );
      }

      return res.json({
        success: true,

        account: {
          id: account.id,
          name: account.name,
          active:
            Boolean(account.active)
        },

        robot:
          formatConfig(config)
      });
    } catch (error) {
      console.error(
        "ERRO AO CONSULTAR STATUS DO ROBÔ:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Erro ao consultar status do robô."
      });
    }
  }
);

// ============================================================
// POST /api/robot/config
// ============================================================

router.post(
  "/config",
  authMiddleware,
  async (req, res) => {
    try {
      await ensureRobotTables();

      const accountId =
        Number(
          req.body.accountId ||
          req.body.account
        );

      if (
        !Number.isInteger(
          accountId
        ) ||
        accountId <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Conta Binance não informada."
        });
      }

      const account =
        await getUserAccount(
          req.user.id,
          accountId
        );

      if (!account) {
        return res.status(404).json({
          success: false,
          error:
            "Conta Binance não encontrada ou não pertence ao usuário."
        });
      }

      // ========================================================
      // CONFIGURAÇÕES RECEBIDAS
      // ========================================================

      const strategyVersion =
        String(
          req.body.strategyVersion ||
          "v7.1"
        );

      const entryPercent =
        numberValue(
          req.body.entryPercent ??
          req.body.entry
        );

      const takeProfitPercent =
        numberValue(
          req.body.takeProfitPercent ??
          req.body.takeProfit ??
          req.body.tp
        );

      const stopLossPercent =
        numberValue(
          req.body.stopLossPercent ??
          req.body.stopLoss ??
          req.body.sl
        );

      const maxOperations =
        numberValue(
          req.body.maxOperations ??
          req.body.maxOps
        );

      const maxCoins =
        numberValue(
          req.body.maxCoins
        );

      const interval =
        String(
          req.body.interval ||
          "15m"
        );

      const stopLossActive =
        booleanValue(
          req.body.stopLossActive
        );

      // ========================================================
      // VALIDAÇÕES
      // ========================================================

      if (
        !STRATEGIES.includes(
          strategyVersion
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Estratégia inválida."
        });
      }

      if (
        !Number.isFinite(
          entryPercent
        ) ||
        entryPercent < 0 ||
        entryPercent > 100
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Entrada deve estar entre 0 e 100%."
        });
      }

      if (
        !Number.isFinite(
          takeProfitPercent
        ) ||
        takeProfitPercent <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Take Profit deve ser maior que 0%."
        });
      }

      if (
        !Number.isFinite(
          stopLossPercent
        ) ||
        stopLossPercent <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Stop Loss deve ser maior que 0%."
        });
      }

      if (
        !Number.isInteger(
          maxOperations
        ) ||
        maxOperations < 1 ||
        maxOperations > 3
      ) {
        return res.status(400).json({
          success: false,
          error:
            "O limite de operações deve estar entre 1 e 3."
        });
      }

      if (
        !Number.isInteger(
          maxCoins
        ) ||
        maxCoins < 1 ||
        maxCoins > 50
      ) {
        return res.status(400).json({
          success: false,
          error:
            "O limite de moedas deve estar entre 1 e 50."
        });
      }

      if (
        !INTERVALS.includes(
          interval
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Intervalo inválido."
        });
      }

      if (
        stopLossActive === null
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Stop Loss ativo deve ser verdadeiro ou falso."
        });
      }

      // ========================================================
      // SALVAR
      // ========================================================

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
              running,
              created_at,
              updated_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10,
              FALSE,
              NOW(),
              NOW()
            )
            ON CONFLICT (user_id, account_id)
            DO UPDATE SET
              strategy_version =
                EXCLUDED.strategy_version,

              entry_percent =
                EXCLUDED.entry_percent,

              take_profit_percent =
                EXCLUDED.take_profit_percent,

              stop_loss_percent =
                EXCLUDED.stop_loss_percent,

              stop_loss_active =
                EXCLUDED.stop_loss_active,

              max_operations =
                EXCLUDED.max_operations,

              interval =
                EXCLUDED.interval,

              max_coins =
                EXCLUDED.max_coins,

              updated_at =
                NOW()

            RETURNING *
          `,
          [
            req.user.id,
            accountId,
            strategyVersion,
            entryPercent,
            takeProfitPercent,
            stopLossPercent,
            stopLossActive,
            maxOperations,
            interval,
            maxCoins
          ]
        );

      return res.json({
        success: true,

        message:
          "Configuração do robô salva com sucesso.",

        robot:
          formatConfig(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "ERRO AO SALVAR CONFIGURAÇÃO DO ROBÔ:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Erro ao salvar configuração do robô."
      });
    }
  }
);

// ============================================================
// POST /api/robot/start
// ============================================================

router.post(
  "/start",
  authMiddleware,
  async (req, res) => {
    try {
      await ensureRobotTables();

      const accountId =
        Number(
          req.body.accountId ||
          req.body.account
        );

      if (
        !Number.isInteger(
          accountId
        ) ||
        accountId <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Conta Binance não informada."
        });
      }

      const account =
        await getUserAccount(
          req.user.id,
          accountId
        );

      if (!account) {
        return res.status(404).json({
          success: false,
          error:
            "Conta Binance não encontrada ou não pertence ao usuário."
        });
      }

      if (!account.active) {
        return res.status(400).json({
          success: false,
          error:
            "A conta Binance está desativada."
        });
      }

      let config =
        await getRobotConfig(
          req.user.id,
          accountId
        );

      if (!config) {
        config =
          await createDefaultConfig(
            req.user.id,
            accountId
          );
      }

      // ========================================================
      // MARCA COMO ATIVO
      // ========================================================

      const result =
        await db.query(
          `
            UPDATE robot_configs
            SET
              running = TRUE,
              updated_at = NOW()
            WHERE user_id = $1
              AND account_id = $2
            RETURNING *
          `,
          [
            req.user.id,
            accountId
          ]
        );

      // ========================================================
      // O ENGINE SERÁ INICIADO PELO SERVICE
      // ========================================================
      //
      // Não fazemos require do robotEngine aqui para evitar
      // dependência circular. O server/engine poderá assumir
      // a execução após a configuração ser marcada como ativa.
      //
      // ========================================================

      return res.json({
        success: true,

        message:
          "Robô iniciado.",

        robot:
          formatConfig(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "ERRO AO INICIAR ROBÔ:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Erro ao iniciar o robô."
      });
    }
  }
);

// ============================================================
// POST /api/robot/stop
// ============================================================

router.post(
  "/stop",
  authMiddleware,
  async (req, res) => {
    try {
      await ensureRobotTables();

      const accountId =
        Number(
          req.body.accountId ||
          req.body.account
        );

      if (
        !Number.isInteger(
          accountId
        ) ||
        accountId <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Conta Binance não informada."
        });
      }

      const account =
        await getUserAccount(
          req.user.id,
          accountId
        );

      if (!account) {
        return res.status(404).json({
          success: false,
          error:
            "Conta Binance não encontrada ou não pertence ao usuário."
        });
      }

      const result =
        await db.query(
          `
            UPDATE robot_configs
            SET
              running = FALSE,
              updated_at = NOW()
            WHERE user_id = $1
              AND account_id = $2
            RETURNING *
          `,
          [
            req.user.id,
            accountId
          ]
        );

      if (!result.rows.length) {
        return res.json({
          success: true,

          message:
            "Robô já estava parado.",

          robot: null
        });
      }

      return res.json({
        success: true,

        message:
          "Robô parado.",

        robot:
          formatConfig(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "ERRO AO PARAR ROBÔ:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Erro ao parar o robô."
      });
    }
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
