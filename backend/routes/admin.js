const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

function isAdmin(req) {
  const configuredAdminId = String(process.env.ADMIN_USER_ID || "").trim();
  const currentUserId = String(req.user?.id || req.user?.userId || "").trim();

  return !!configuredAdminId &&
    !!currentUserId &&
    configuredAdminId === currentUserId;
}

function deny(res) {
  return res.status(403).json({
    success: false,
    error: "Acesso administrativo não autorizado."
  });
}

router.get("/dashboard", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  try {
    const [
      usersResult,
      subscriptionsResult,
      robotsResult,
      accountsResult,
      plansResult,
      recentPaymentsResult
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
          ), 0)::numeric AS mrr
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
            WHEN 'premium' THEN 1
            WHEN 'profissional' THEN 2
            WHEN 'basico' THEN 3
            ELSE 4
          END
      `),

      db.query(`
        SELECT
          s.id,
          s.user_id,
          u.name,
          u.email,
          s.plan,
          s.status,
          s.amount,
          s.payment_provider,
          s.payment_method,
          s.started_at,
          s.expires_at,
          s.created_at,
          s.updated_at
        FROM subscriptions s
        LEFT JOIN users u ON u.id = s.user_id
        ORDER BY COALESCE(s.updated_at, s.created_at) DESC
        LIMIT 20
      `)
    ]);

    const users = usersResult.rows[0] || {};
    const subscriptions = subscriptionsResult.rows[0] || {};
    const robots = robotsResult.rows[0] || {};
    const accounts = accountsResult.rows[0] || {};

    const money = value => Number(value || 0);

    const planNames = {
      basico: "Básico",
      profissional: "Profissional",
      premium: "Premium"
    };

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),

      resumo: {
        usuariosTotal: Number(users.total || 0),
        usuariosAtivos: Number(users.active || 0),
        usuariosInativos: Number(users.inactive || 0),

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

      assinaturasRecentes: recentPaymentsResult.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        nome: row.name || "—",
        email: row.email || "—",
        plano: row.plan,
        status: row.status,
        valor: money(row.amount),
        provedor: row.payment_provider || "—",
        metodo: row.payment_method || "—",
        iniciadoEm: row.started_at,
        expiraEm: row.expires_at,
        criadoEm: row.created_at,
        atualizadoEm: row.updated_at
      }))
    });
  } catch (error) {
    console.error("ERRO DASHBOARD ADMIN:", error);

    res.status(500).json({
      success: false,
      error: "Erro interno ao carregar o painel administrativo."
    });
  }
});

router.get("/teste", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  res.json({
    success: true,
    admin: true,
    userId: req.user?.id || req.user?.userId || null
  });
});

module.exports = router;
