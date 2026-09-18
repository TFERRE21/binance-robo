const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

/*
 * CRIPTOPRO — PAINEL ADMINISTRATIVO
 * Acesso protegido por JWT + ADMIN_USER_ID.
 *
 * No Northflank:
 * ADMIN_USER_ID = 3
 */

function getAuthenticatedUserId(req) {
  const user = req.user || {};

  const candidates = [
    user.id,
    user.userId,
    user.user_id,
    user.sub,
    user.user?.id,
    user.user?.userId
  ];

  const found = candidates.find(
    value => value !== undefined && value !== null && String(value).trim() !== ""
  );

  return found !== undefined ? String(found).trim() : "";
}

function isAdmin(req) {
  const configuredAdminId = String(process.env.ADMIN_USER_ID || "").trim();
  const authenticatedUserId = getAuthenticatedUserId(req);

  return (
    configuredAdminId !== "" &&
    authenticatedUserId !== "" &&
    configuredAdminId === authenticatedUserId
  );
}

function deny(res) {
  return res.status(403).json({
    success: false,
    message: "Acesso administrativo não autorizado."
  });
}

function money(value) {
  return Number(value || 0);
}

const planNames = {
  basico: "Básico",
  profissional: "Profissional",
  premium: "Premium"
};

// ============================================================
// TESTE ADMIN
// ============================================================

router.get("/teste", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  return res.json({
    success: true,
    admin: true,
    userId: getAuthenticatedUserId(req)
  });
});

// ============================================================
// DASHBOARD ADMIN
// ============================================================

router.get("/dashboard", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  try {
    const [
      usersResult,
      subscriptionsResult,
      robotsResult,
      accountsResult,
      plansResult
    ] = await Promise.all([

      db.query(`
        SELECT COUNT(*)::int AS total
        FROM users
      `),

      db.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE status = 'ACTIVE'
              AND (expires_at IS NULL OR expires_at > NOW())
          )::int AS active,

          COUNT(*) FILTER (
            WHERE status = 'PENDING'
          )::int AS pending,

          COUNT(*) FILTER (
            WHERE status = 'CANCELLED'
          )::int AS cancelled,

          COUNT(*) FILTER (
            WHERE status = 'EXPIRED'
          )::int AS expired,

          COALESCE(SUM(
            CASE
              WHEN status = 'ACTIVE'
                AND (expires_at IS NULL OR expires_at > NOW())
              THEN amount
              ELSE 0
            END
          ), 0)::numeric AS mrr

        FROM subscriptions
      `),

      db.query(`
        SELECT
          COUNT(*)::int AS configured,
          COUNT(*) FILTER (
            WHERE running = true
          )::int AS running
        FROM robot_configs
      `),

      db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE active = true
          )::int AS active
        FROM binance_accounts
      `),

      db.query(`
        SELECT
          plan,
          COUNT(*) FILTER (
            WHERE status = 'ACTIVE'
              AND (expires_at IS NULL OR expires_at > NOW())
          )::int AS active,

          COALESCE(SUM(
            CASE
              WHEN status = 'ACTIVE'
                AND (expires_at IS NULL OR expires_at > NOW())
              THEN amount
              ELSE 0
            END
          ), 0)::numeric AS monthly_value

        FROM subscriptions
        GROUP BY plan
        ORDER BY
          CASE plan
            WHEN 'premium' THEN 1
            WHEN 'profissional' THEN 2
            WHEN 'basico' THEN 3
            ELSE 4
          END
      `)
    ]);

    const users = usersResult.rows[0] || {};
    const subscriptions = subscriptionsResult.rows[0] || {};
    const robots = robotsResult.rows[0] || {};
    const accounts = accountsResult.rows[0] || {};

    /*
     * Todos os usuários + última assinatura de cada usuário.
     * LATERAL evita duplicar o usuário quando existem várias assinaturas.
     */
    const usersDetailResult = await db.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.active,

        s.id AS subscription_id,
        s.plan,
        s.status,
        s.amount,
        s.payment_provider,
        s.payment_method,
        s.started_at,
        s.expires_at,
        s.created_at AS subscription_created_at

      FROM users u

      LEFT JOIN LATERAL (
        SELECT *
        FROM subscriptions
        WHERE user_id = u.id
        ORDER BY id DESC
        LIMIT 1
      ) s ON true

      ORDER BY u.id DESC
    `);

    const usuarios = usersDetailResult.rows.map(row => ({
      id: row.id,
      nome: row.name || "—",
      email: row.email || "—",
      ativo: row.active !== false,

      assinaturaId: row.subscription_id || null,
      plano: row.plan || null,
      planoNome: planNames[row.plan] || row.plan || "—",

      status: row.status || "SEM ASSINATURA",
      valor: money(row.amount),

      provedor: row.payment_provider || "—",
      metodo: row.payment_method || "—",

      iniciadoEm: row.started_at || null,
      expiraEm: row.expires_at || null,
      assinaturaCriadaEm: row.subscription_created_at || null
    }));

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),

      resumo: {
        usuariosTotal: Number(users.total || 0),

        assinaturasAtivas: Number(subscriptions.active || 0),
        pagamentosPendentes: Number(subscriptions.pending || 0),
        assinaturasCanceladas: Number(subscriptions.cancelled || 0),
        assinaturasExpiradas: Number(subscriptions.expired || 0),

        valorMensalAtivo: money(subscriptions.mrr),

        robosConfigurados: Number(robots.configured || 0),
        robosRodando: Number(robots.running || 0),

        apisBinanceTotal: Number(accounts.total || 0),
        apisBinanceAtivas: Number(accounts.active || 0)
      },

      planos: plansResult.rows.map(row => ({
        plan: row.plan,
        nome: planNames[row.plan] || row.plan || "—",
        ativos: Number(row.active || 0),
        valorMensal: money(row.monthly_value)
      })),

      usuarios
    });

  } catch (error) {
    console.error("ERRO DASHBOARD ADMIN:", error);

    return res.status(500).json({
      success: false,
      message: "Erro interno ao carregar o painel administrativo."
    });
  }
});

module.exports = router;
