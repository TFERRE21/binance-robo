const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

// ============================================================
// CRIPTOPRO — PAINEL ADMINISTRATIVO
// ============================================================
// O acesso depende de:
// 1. JWT válido
// 2. ADMIN_USER_ID configurado no ambiente do servidor
//
// Exemplo no Northflank:
// ADMIN_USER_ID=3
// ============================================================

function isAdmin(req) {
  const configuredAdminId = String(process.env.ADMIN_USER_ID || "").trim();
  const currentUserId = String(
    req.user?.id ?? req.user?.userId ?? ""
  ).trim();

  return (
    configuredAdminId !== "" &&
    currentUserId !== "" &&
    configuredAdminId === currentUserId
  );
}

function deny(res) {
  return res.status(403).json({
    success: false,
    error: "Acesso administrativo não autorizado."
  });
}

// ============================================================
// TESTE DE ACESSO
// ============================================================

router.get("/teste", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  return res.json({
    success: true,
    admin: true,
    userId: String(req.user?.id ?? req.user?.userId ?? "")
  });
});

// ============================================================
// DASHBOARD ADMINISTRATIVO
// ============================================================

router.get("/dashboard", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  try {
    const [
      usersResult,
      subscriptionsResult,
      robotsResult,
      accountsResult,
      plansResult,
      usersListResult
    ] = await Promise.all([
      // --------------------------------------------------------
      // USUÁRIOS
      // --------------------------------------------------------
      db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE active = true)::int AS active,
          COUNT(*) FILTER (WHERE active = false)::int AS inactive
        FROM users
      `),

      // --------------------------------------------------------
      // ASSINATURAS / RECEITA MENSAL ATIVA
      // --------------------------------------------------------
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

          COALESCE(
            SUM(
              CASE
                WHEN status = 'ACTIVE'
                  AND (expires_at IS NULL OR expires_at > NOW())
                THEN amount
                ELSE 0
              END
            ),
            0
          )::numeric AS mrr
        FROM subscriptions
      `),

      // --------------------------------------------------------
      // ROBÔS
      // --------------------------------------------------------
      db.query(`
        SELECT
          COUNT(*)::int AS configured,
          COUNT(*) FILTER (WHERE running = true)::int AS running
        FROM robot_configs
      `),

      // --------------------------------------------------------
      // APIS BINANCE
      // --------------------------------------------------------
      db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE active = true)::int AS active
        FROM binance_accounts
      `),

      // --------------------------------------------------------
      // PLANOS
      // --------------------------------------------------------
      db.query(`
        SELECT
          plan,

          COUNT(*) FILTER (
            WHERE status = 'ACTIVE'
              AND (expires_at IS NULL OR expires_at > NOW())
          )::int AS active,

          COALESCE(
            SUM(
              CASE
                WHEN status = 'ACTIVE'
                  AND (expires_at IS NULL OR expires_at > NOW())
                THEN amount
                ELSE 0
              END
            ),
            0
          )::numeric AS monthly_value

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

      // --------------------------------------------------------
      // TODOS OS USUÁRIOS
      // Pega a assinatura mais recente de cada usuário.
      // --------------------------------------------------------
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

    return res.json({
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

      usuarios: usersListResult.rows.map(row => ({
        id: row.id,
        nome: row.name || "—",
        email: row.email || "—",
        ativo: row.active !== false,

        assinaturaId: row.subscription_id || null,
        plano: row.plan || null,
        status: row.status || "SEM ASSINATURA",
        valor: money(row.amount),

        provedor: row.payment_provider || "—",
        metodo: row.payment_method || "—",

        iniciadoEm: row.started_at || null,
        expiraEm: row.expires_at || null,
        criadoEm: row.subscription_created_at || null
      }))
    });

  } catch (error) {
    console.error("ERRO DASHBOARD ADMIN:", error);

    return res.status(500).json({
      success: false,
      error: "Erro interno ao carregar o painel administrativo."
    });
  }
});

module.exports = router;
