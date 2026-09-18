const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

/*
 * CRIPTOPRO - PAINEL ADMINISTRATIVO
 * SOMENTE O ADMINISTRADOR CONFIGURADO NO NORTHFLANK PODE
 * CONSULTAR ESTA API.
 *
 * Variável obrigatória:
 * ADMIN_USER_ID=3
 */

function getCurrentUserId(req) {
  return String(req.user?.id ?? req.user?.userId ?? "").trim();
}

function isAdmin(req) {
  const adminId = String(process.env.ADMIN_USER_ID || "").trim();
  const userId = getCurrentUserId(req);
  return !!adminId && !!userId && adminId === userId;
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

const PLAN_NAMES = {
  basico: "Básico",
  profissional: "Profissional",
  premium: "Premium"
};

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
      usersCountResult,
      subscriptionsResult,
      robotsResult,
      accountsResult,
      plansResult,
      usersResult
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
              THEN amount
              ELSE 0
            END
          ), 0)::numeric AS monthly_revenue
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
              THEN amount
              ELSE 0
            END
          ), 0)::numeric AS monthly_value
        FROM subscriptions
        GROUP BY plan
        ORDER BY
          CASE plan
            WHEN 'basico' THEN 1
            WHEN 'profissional' THEN 2
            WHEN 'premium' THEN 3
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
      `)
    ]);

    const usersCount = usersCountResult.rows[0] || {};
    const subscriptions = subscriptionsResult.rows[0] || {};
    const robots = robotsResult.rows[0] || {};
    const accounts = accountsResult.rows[0] || {};

    const usuarios = usersResult.rows.map(row => ({
      id: row.id,
      nome: row.name || "—",
      email: row.email || "—",
      ativo: row.active !== false,
      assinaturaId: row.subscription_id || null,
      plano: row.plan || null,
      planoNome: PLAN_NAMES[row.plan] || row.plan || "Sem plano",
      status: row.status || "SEM ASSINATURA",
      valor: money(row.amount),
      provedor: row.payment_provider || "—",
      metodo: row.payment_method || "—",
      iniciadoEm: row.started_at || null,
      expiraEm: row.expires_at || null,
      assinaturaCriadaEm: row.subscription_created_at || null
    }));

    const planos = plansResult.rows.map(row => ({
      plan: row.plan,
      nome: PLAN_NAMES[row.plan] || row.plan || "—",
      ativos: Number(row.active || 0),
      valorMensal: money(row.monthly_value)
    }));

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      resumo: {
        usuariosTotal: Number(usersCount.total || 0),
        usuariosAtivos: Number(usersCount.active || 0),
        usuariosInativos: Number(usersCount.inactive || 0),
        assinaturasAtivas: Number(subscriptions.active || 0),
        pagamentosPendentes: Number(subscriptions.pending || 0),
        assinaturasCanceladas: Number(subscriptions.cancelled || 0),
        assinaturasExpiradas: Number(subscriptions.expired || 0),
        valorMensalAtivo: money(subscriptions.monthly_revenue),
        robosConfigurados: Number(robots.configured || 0),
        robosRodando: Number(robots.running || 0),
        apisBinanceTotal: Number(accounts.total || 0),
        apisBinanceAtivas: Number(accounts.active || 0)
      },
      planos,
      usuarios,
      assinaturasRecentes: usuarios
        .filter(u => u.assinaturaId !== null)
        .slice(0, 20)
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
