const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

function getCurrentUserId(req) {
  return String(req.user?.id ?? req.user?.userId ?? "").trim();
}

function isAdmin(req) {
  const adminId = String(process.env.ADMIN_USER_ID || "").trim();
  return !!adminId && !!getCurrentUserId(req) && adminId === getCurrentUserId(req);
}

function deny(res) {
  return res.status(403).json({
    success: false,
    message: "Acesso administrativo não autorizado.",
    error: "Acesso administrativo não autorizado."
  });
}

const PLAN_NAMES = {
  basico: "Básico",
  profissional: "Profissional",
  premium: "Premium"
};

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

router.get("/teste", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  return res.json({
    success: true,
    admin: true,
    userId: getCurrentUserId(req)
  });
});

router.get("/dashboard", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  try {
    const [
      usersResult,
      subscriptionSummaryResult,
      robotResult,
      accountsResult,
      planResult,
      usersListResult
    ] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE active = true)::int AS active,
          COUNT(*) FILTER (WHERE active = false)::int AS inactive
        FROM users
      `),

      db.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE status = 'ACTIVE'
              AND (expires_at IS NULL OR expires_at > NOW())
          )::int AS active,
          COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
          COUNT(*) FILTER (WHERE status = 'EXPIRED')::int AS expired,
          COALESCE(SUM(
            CASE
              WHEN status = 'ACTIVE'
                AND (expires_at IS NULL OR expires_at > NOW())
              THEN amount ELSE 0
            END
          ), 0)::numeric AS monthly_value
        FROM subscriptions
      `),

      db.query(`
        SELECT
          COUNT(*)::int AS configured,
          COUNT(*) FILTER (WHERE running = true)::int AS running
        FROM robot_configs
      `),

      db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE active = true)::int AS active
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
              THEN amount ELSE 0
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
      `),

      db.query(`
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
          s.created_at AS subscription_created_at,
          s.updated_at AS subscription_updated_at
        FROM users u
        LEFT JOIN LATERAL (
          SELECT
            id, plan, status, amount, payment_provider, payment_method,
            started_at, expires_at, created_at, updated_at
          FROM subscriptions
          WHERE user_id = u.id
          ORDER BY id DESC
          LIMIT 1
        ) s ON true
        ORDER BY u.id DESC
      `)
    ]);

    const users = usersResult.rows[0] || {};
    const summary = subscriptionSummaryResult.rows[0] || {};
    const robots = robotResult.rows[0] || {};
    const accounts = accountsResult.rows[0] || {};

    const valorMensalAtivo = money(summary.monthly_value);

    const planos = planResult.rows.map(row => ({
      plan: row.plan,
      nome: PLAN_NAMES[row.plan] || row.plan || "—",
      active: Number(row.active || 0),
      ativos: Number(row.active || 0),
      monthly_value: money(row.monthly_value),
      valorMensal: money(row.monthly_value)
    }));

    const usuarios = usersListResult.rows.map(row => ({
      id: row.id,
      userId: row.id,
      nome: row.name || "—",
      name: row.name || "—",
      email: row.email || "—",
      conta: row.active !== false ? "ATIVA" : "INATIVA",
      ativo: row.active !== false,
      active: row.active !== false,
      assinaturaId: row.subscription_id || null,
      subscriptionId: row.subscription_id || null,
      plano: row.plan || null,
      plan: row.plan || null,
      status: row.status || "SEM ASSINATURA",
      valor: money(row.amount),
      amount: money(row.amount),
      provedor: row.payment_provider || "—",
      paymentProvider: row.payment_provider || "—",
      metodo: row.payment_method || "—",
      paymentMethod: row.payment_method || "—",
      iniciadoEm: row.started_at || null,
      startedAt: row.started_at || null,
      expiraEm: row.expires_at || null,
      expiresAt: row.expires_at || null,
      criadoEm: row.subscription_created_at || null,
      atualizadoEm: row.subscription_updated_at || null
    }));

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      resumo: {
        usuariosTotal: Number(users.total || 0),
        usuariosAtivos: Number(users.active || 0),
        usuariosInativos: Number(users.inactive || 0),
        assinaturasAtivas: Number(summary.active || 0),
        pagamentosPendentes: Number(summary.pending || 0),
        assinaturasCanceladas: Number(summary.cancelled || 0),
        assinaturasExpiradas: Number(summary.expired || 0),
        valorMensalAtivo,
        receitaMensalAtiva: valorMensalAtivo,
        robosConfigurados: Number(robots.configured || 0),
        robosRodando: Number(robots.running || 0),
        apisBinanceTotal: Number(accounts.total || 0),
        apisBinanceAtivas: Number(accounts.active || 0)
      },
      planos,
      usuarios,
      users: usuarios,
      assinaturasRecentes: usuarios.slice(0, 20)
    });
  } catch (error) {
    console.error("ERRO DASHBOARD ADMIN:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno ao carregar o painel administrativo.",
      error: "Erro interno ao carregar o painel administrativo."
    });
  }
});

module.exports = router;
