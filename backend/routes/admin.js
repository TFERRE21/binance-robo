const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

const PLAN_NAMES = {
  basico: "Básico",
  profissional: "Profissional",
  premium: "Premium"
};

function isAdmin(req) {
  const adminId = String(process.env.ADMIN_USER_ID || "").trim();
  const userId = String(req.user?.id || req.user?.userId || "").trim();
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

function planName(plan) {
  return PLAN_NAMES[String(plan || "").toLowerCase()] || plan || "—";
}

/*
 * CriptoPro — Painel Administrativo
 *
 * Requer:
 * ADMIN_USER_ID=<ID do administrador>
 *
 * O JWT e o ADMIN_USER_ID são obrigatórios.
 */

router.get("/dashboard", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  try {
    const [
      usersSummary,
      subscriptionSummary,
      planSummary,
      usersGrowth,
      revenueGrowth,
      robotSummary,
      accountsSummary,
      usersList,
      expiringSoon,
      recentSubscriptions
    ] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE active = true)::int AS ativos,
          COUNT(*) FILTER (WHERE active = false)::int AS inativos
        FROM users
      `),

      db.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE status = 'ACTIVE'
              AND (expires_at IS NULL OR expires_at > NOW())
          )::int AS ativas,
          COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pendentes,
          COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS canceladas,
          COUNT(*) FILTER (WHERE status = 'EXPIRED')::int AS expiradas,
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
          plan,
          COUNT(*) FILTER (
            WHERE status = 'ACTIVE'
              AND (expires_at IS NULL OR expires_at > NOW())
          )::int AS ativos,
          COALESCE(SUM(
            CASE
              WHEN status = 'ACTIVE'
                AND (expires_at IS NULL OR expires_at > NOW())
              THEN amount
              ELSE 0
            END
          ), 0)::numeric AS receita_mensal
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
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS mes,
          COUNT(*)::int AS novos
        FROM users
        WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
      `),

      db.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS mes,
          COALESCE(SUM(amount), 0)::numeric AS valor
        FROM subscriptions
        WHERE status = 'ACTIVE'
          AND created_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
      `),

      db.query(`
        SELECT
          COUNT(*)::int AS configurados,
          COUNT(*) FILTER (WHERE running = true)::int AS rodando
        FROM robot_configs
      `),

      db.query(`
        SELECT COUNT(*)::int AS total
        FROM binance_accounts
      `),

      db.query(`
        SELECT
          u.id,
          u.name,
          u.email,
          u.active,
          s.id AS subscription_id,
          s.plan,
          s.status AS subscription_status,
          s.amount,
          s.payment_provider,
          s.payment_method,
          s.started_at,
          s.expires_at,
          s.created_at AS subscription_created_at
        FROM users u
        LEFT JOIN LATERAL (
          SELECT
            id,
            plan,
            status,
            amount,
            payment_provider,
            payment_method,
            started_at,
            expires_at,
            created_at
          FROM subscriptions
          WHERE user_id = u.id
          ORDER BY id DESC
          LIMIT 1
        ) s ON true
        ORDER BY u.id DESC
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
          s.expires_at
        FROM subscriptions s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.status = 'ACTIVE'
          AND s.expires_at IS NOT NULL
          AND s.expires_at > NOW()
          AND s.expires_at <= NOW() + INTERVAL '7 days'
        ORDER BY s.expires_at ASC
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
        ORDER BY s.id DESC
        LIMIT 30
      `)
    ]);

    const us = usersSummary.rows[0] || {};
    const ss = subscriptionSummary.rows[0] || {};
    const rs = robotSummary.rows[0] || {};
    const bs = accountsSummary.rows[0] || {};

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),

      resumo: {
        usuariosTotal: Number(us.total || 0),
        usuariosAtivos: Number(us.ativos || 0),
        usuariosInativos: Number(us.inativos || 0),

        assinaturasAtivas: Number(ss.ativas || 0),
        pagamentosPendentes: Number(ss.pendentes || 0),
        assinaturasCanceladas: Number(ss.canceladas || 0),
        assinaturasExpiradas: Number(ss.expiradas || 0),

        receitaMensalAtiva: money(ss.mrr),

        robosConfigurados: Number(rs.configurados || 0),
        robosRodando: Number(rs.rodando || 0),

        apisBinanceTotal: Number(bs.total || 0)
      },

      planos: planSummary.rows.map(row => ({
        codigo: row.plan,
        nome: planName(row.plan),
        usuariosAtivos: Number(row.ativos || 0),
        receitaMensal: money(row.receita_mensal)
      })),

      crescimentoUsuarios: usersGrowth.rows.map(row => ({
        mes: row.mes,
        novosUsuarios: Number(row.novos || 0)
      })),

      crescimentoReceita: revenueGrowth.rows.map(row => ({
        mes: row.mes,
        valor: money(row.valor)
      })),

      vencimentosProximos: expiringSoon.rows.map(row => ({
        assinaturaId: row.id,
        userId: row.user_id,
        nome: row.name || "—",
        email: row.email || "—",
        plano: row.plan,
        planoNome: planName(row.plan),
        status: row.status,
        valor: money(row.amount),
        vencimento: row.expires_at
      })),

      usuarios: usersList.rows.map(row => ({
        id: row.id,
        nome: row.name || "—",
        email: row.email || "—",
        ativo: row.active !== false,
        assinaturaId: row.subscription_id || null,
        plano: row.plan || null,
        planoNome: planName(row.plan),
        status: row.subscription_status || "SEM ASSINATURA",
        valor: money(row.amount),
        provedor: row.payment_provider || "—",
        metodo: row.payment_method || "—",
        iniciadoEm: row.started_at || null,
        expiraEm: row.expires_at || null,
        assinaturaCriadaEm: row.subscription_created_at || null
      })),

      assinaturasRecentes: recentSubscriptions.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        nome: row.name || "—",
        email: row.email || "—",
        plano: row.plan,
        planoNome: planName(row.plan),
        status: row.status,
        valor: money(row.amount),
        provedor: row.payment_provider || "—",
        metodo: row.payment_method || "—",
        iniciadoEm: row.started_at || null,
        expiraEm: row.expires_at || null,
        criadoEm: row.created_at || null,
        atualizadoEm: row.updated_at || null
      }))
    });

  } catch (error) {
    console.error("ERRO DASHBOARD ADMIN:", error);

    return res.status(500).json({
      success: false,
      message: "Erro interno ao carregar o painel administrativo."
    });
  }
});

router.get("/teste", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  return res.json({
    success: true,
    admin: true,
    userId: String(req.user?.id || req.user?.userId || "")
  });
});

module.exports = router;
