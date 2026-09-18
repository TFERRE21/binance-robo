const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

/*
 * CRIPTOPRO — PAINEL ADMINISTRATIVO
 *
 * Este arquivo NÃO cria um painel para os clientes.
 * Ele fornece apenas a API usada pelo seu painel administrativo.
 *
 * SEGURANÇA:
 * 1. JWT válido
 * 2. ID do usuário precisa ser igual a ADMIN_USER_ID
 *
 * No Northflank:
 * ADMIN_USER_ID=3
 */

function getCurrentUserId(req) {
  return String(req.user?.id ?? req.user?.userId ?? "").trim();
}

function isAdmin(req) {
  const adminId = String(process.env.ADMIN_USER_ID || "").trim();
  const currentId = getCurrentUserId(req);

  return !!adminId && !!currentId && adminId === currentId;
}

function deny(res) {
  return res.status(403).json({
    success: false,
    message: "Acesso administrativo não autorizado."
  });
}

/*
 * TESTE DE ADMIN
 */
router.get("/teste", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  res.json({
    success: true,
    admin: true,
    userId: getCurrentUserId(req)
  });
});

/*
 * DASHBOARD ADMIN
 *
 * Retorna:
 * - total de usuários
 * - usuários ativos/inativos
 * - assinaturas
 * - receita mensal ativa
 * - robôs configurados/rodando
 * - APIs Binance
 * - distribuição por plano
 * - lista de usuários
 * - últimas assinaturas
 */
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

      // USUÁRIOS
      db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE active = true)::int AS active,
          COUNT(*) FILTER (WHERE active = false)::int AS inactive
        FROM users
      `),

      // ASSINATURAS / RECEITA
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
          ), 0)::numeric AS monthly_revenue

        FROM subscriptions
      `),

      // ROBÔS
      db.query(`
        SELECT
          COUNT(*)::int AS configured,
          COUNT(*) FILTER (WHERE running = true)::int AS running
        FROM robot_configs
      `),

      // APIS BINANCE
      db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE active = true)::int AS active
        FROM binance_accounts
      `),

      // PLANOS
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
          ), 0)::numeric AS monthly_revenue

        FROM subscriptions
        GROUP BY plan
      `),

      // TODOS OS USUÁRIOS + ASSINATURA MAIS RECENTE
      db.query(`
        SELECT
          u.id,
          u.name,
          u.email,
          u.active AS user_active,

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

    const usuarios = usersListResult.rows.map(row => ({
      id: row.id,
      nome: row.name || "—",
      email: row.email || "—",
      ativo: row.user_active !== false,

      assinaturaId: row.subscription_id || null,
      plano: row.plan || null,
      planoNome: planNames[row.plan] || row.plan || "Sem plano",

      status: row.status || "SEM ASSINATURA",
      valor: money(row.amount),

      provedor: row.payment_provider || "—",
      metodo: row.payment_method || "—",

      iniciadoEm: row.started_at || null,
      expiraEm: row.expires_at || null,
      assinaturaCriadaEm: row.subscription_created_at || null
    }));

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

        receitaMensal: money(subscriptions.monthly_revenue),

        robosConfigurados: Number(robots.configured || 0),
        robosRodando: Number(robots.running || 0),

        apisBinanceTotal: Number(accounts.total || 0),
        apisBinanceAtivas: Number(accounts.active || 0)
      },

      planos: plansResult.rows.map(row => ({
        plan: row.plan,
        nome: planNames[row.plan] || row.plan || "—",
        usuariosAtivos: Number(row.active || 0),
        receitaMensal: money(row.monthly_revenue)
      })),

      usuarios,

      assinaturasRecentes: usuarios
        .filter(u => u.assinaturaId)
        .slice(0, 20)
    });

  } catch (error) {
    console.error("ERRO PAINEL ADMIN:", error);

    res.status(500).json({
      success: false,
      message: "Erro interno ao carregar os dados administrativos.",
      detail: process.env.NODE_ENV === "development"
        ? error.message
        : undefined
    });
  }
});

module.exports = router;
