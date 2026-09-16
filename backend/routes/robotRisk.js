const express = require("express");

const router = express.Router();

const authMiddleware = require("../middleware/auth");
const db = require("../services/db");

const TERM_VERSION = "1.0";

function getAccountId(req) {
  return Number(
    req.body.accountId ||
    req.body.account ||
    req.query.accountId ||
    req.query.account
  );
}

async function ensureRiskTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS robot_risk_acceptances (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      robot_config_id INTEGER NOT NULL,
      term_version VARCHAR(20) NOT NULL,
      config_signature TEXT NOT NULL,
      accepted_at TIMESTAMP NOT NULL DEFAULT NOW(),
      ip_address VARCHAR(100),
      user_agent TEXT
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_robot_risk_user_account
    ON robot_risk_acceptances(user_id, account_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_robot_risk_config
    ON robot_risk_acceptances(robot_config_id, term_version)
  `);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }

  return req.ip || null;
}

function buildConfigSignature(config) {
  return [
    Number(config.id),
    config.strategy_version,
    Number(config.entry_percent),
    Number(config.take_profit_percent),
    Number(config.stop_loss_percent),
    Boolean(config.stop_loss_active),
    Number(config.max_operations),
    config.interval,
    Number(config.max_coins)
  ].join("|");
}

async function getUserAccount(userId, accountId) {
  const result = await db.query(
    `
      SELECT id, user_id, name, active
      FROM binance_accounts
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [accountId, userId]
  );

  return result.rows[0] || null;
}

async function getRobotConfig(userId, accountId) {
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
    [userId, accountId]
  );

  return result.rows[0] || null;
}

const riskMiddleware = async (req, res, next) => {
  try {
    await ensureRiskTable();

    const accountId = getAccountId(req);

    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({
        success: false,
        error: "Conta Binance não informada."
      });
    }

    const config = await getRobotConfig(
      req.user.id,
      accountId
    );

    if (!config) {
      return res.status(400).json({
        success: false,
        error: "Configure o robô antes de iniciar."
      });
    }

    const signature = buildConfigSignature(config);

    const result = await db.query(
      `
        SELECT
          id,
          term_version,
          accepted_at
        FROM robot_risk_acceptances
        WHERE user_id = $1
          AND account_id = $2
          AND robot_config_id = $3
          AND term_version = $4
          AND config_signature = $5
        ORDER BY accepted_at DESC
        LIMIT 1
      `,
      [
        req.user.id,
        accountId,
        config.id,
        TERM_VERSION,
        signature
      ]
    );

    if (!result.rows.length) {
      return res.status(403).json({
        success: false,
        code: "RISK_TERM_REQUIRED",
        error:
          "É necessário aceitar o Termo de Responsabilidade e Ciência de Riscos antes de iniciar o robô."
      });
    }

    req.robotRiskAcceptance = result.rows[0];

    next();
  } catch (error) {
    console.error(
      "ERRO AO VALIDAR TERMO DE RISCO:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Erro ao validar o termo de responsabilidade."
    });
  }
};

// ============================================================
// POST /api/robot/risk/accept
// Registra o aceite do termo para a configuração atual.
// ============================================================

router.post(
  "/accept",
  authMiddleware,
  async (req, res) => {
    try {
      await ensureRiskTable();

      const accountId = getAccountId(req);

      if (!Number.isInteger(accountId) || accountId <= 0) {
        return res.status(400).json({
          success: false,
          error: "Conta Binance não informada."
        });
      }

      const account = await getUserAccount(
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
          error: "A conta Binance está desativada."
        });
      }

      const config = await getRobotConfig(
        req.user.id,
        accountId
      );

      if (!config) {
        return res.status(400).json({
          success: false,
          error:
            "Configure e salve o robô antes de aceitar o termo."
        });
      }

      const signature = buildConfigSignature(config);

      const result = await db.query(
        `
          INSERT INTO robot_risk_acceptances (
            user_id,
            account_id,
            robot_config_id,
            term_version,
            config_signature,
            accepted_at,
            ip_address,
            user_agent
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            NOW(),
            $6,
            $7
          )
          RETURNING
            id,
            user_id,
            account_id,
            robot_config_id,
            term_version,
            accepted_at
        `,
        [
          req.user.id,
          accountId,
          config.id,
          TERM_VERSION,
          signature,
          getClientIp(req),
          req.headers["user-agent"] || null
        ]
      );

      return res.json({
        success: true,
        message:
          "Termo de Responsabilidade e Ciência de Riscos aceito com sucesso.",
        acceptance: result.rows[0]
      });
    } catch (error) {
      console.error(
        "ERRO AO REGISTRAR ACEITE DO TERMO:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "Erro ao registrar o aceite do termo."
      });
    }
  }
);

// ============================================================
// GET /api/robot/risk/status
// Consulta se a configuração atual possui aceite válido.
// ============================================================

router.get(
  "/status",
  authMiddleware,
  async (req, res) => {
    try {
      await ensureRiskTable();

      const accountId = getAccountId(req);

      if (!Number.isInteger(accountId) || accountId <= 0) {
        return res.status(400).json({
          success: false,
          error: "Conta Binance não informada."
        });
      }

      const config = await getRobotConfig(
        req.user.id,
        accountId
      );

      if (!config) {
        return res.json({
          success: true,
          accepted: false,
          termVersion: TERM_VERSION
        });
      }

      const signature = buildConfigSignature(config);

      const result = await db.query(
        `
          SELECT
            id,
            term_version,
            accepted_at
          FROM robot_risk_acceptances
          WHERE user_id = $1
            AND account_id = $2
            AND robot_config_id = $3
            AND term_version = $4
            AND config_signature = $5
          ORDER BY accepted_at DESC
          LIMIT 1
        `,
        [
          req.user.id,
          accountId,
          config.id,
          TERM_VERSION,
          signature
        ]
      );

      return res.json({
        success: true,
        accepted: result.rows.length > 0,
        termVersion: TERM_VERSION,
        acceptance: result.rows[0] || null
      });
    } catch (error) {
      console.error(
        "ERRO AO CONSULTAR STATUS DO TERMO:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Erro ao consultar o aceite do termo."
      });
    }
  }
);

module.exports = {
  router,
  riskMiddleware
};
