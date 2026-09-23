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

      usuarios: recentPaymentsResult.rows.map(row => ({
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
      })),

      assinaturasRecentes: recentPaymentsResult.rows.slice(0, 20).map(row => ({
        id: row.subscription_id,
        userId: row.id,
        nome: row.name || "—",
        email: row.email || "—",
        plano: row.plan,
        status: row.status,
        valor: money(row.amount),
        provedor: row.payment_provider || "—",
        metodo: row.payment_method || "—",
        iniciadoEm: row.started_at,
        expiraEm: row.expires_at,
        criadoEm: row.subscription_created_at
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

/*
=========================================================
CRIPTOPRO — CENTRAL DE CHAMADOS DO ADMIN
Somente ADMIN_USER_ID pode acessar estas rotas.
=========================================================
*/

router.get("/support/tickets", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  try {
    const result = await db.query(`
      SELECT
        t.id,
        t.user_id,
        u.name AS user_name,
        u.email AS user_email,
        t.subject,
        t.category,
        t.priority,
        t.status,
        t.created_at,
        t.updated_at,
        t.closed_at,
        (
          SELECT sm.message
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
          ORDER BY sm.id DESC
          LIMIT 1
        ) AS last_message
      FROM support_tickets t
      LEFT JOIN users u ON u.id = t.user_id
      ORDER BY
        CASE t.status
          WHEN 'ABERTO' THEN 1
          WHEN 'EM_ATENDIMENTO' THEN 2
          WHEN 'RESPONDIDO' THEN 3
          WHEN 'FECHADO' THEN 4
          ELSE 5
        END,
        t.updated_at DESC,
        t.id DESC
    `);

    return res.json({
      ok: true,
      tickets: result.rows
    });
  } catch (error) {
    console.error("ADMIN SUPORTE — LISTAR:", error);

    return res.status(500).json({
      ok: false,
      erro: "Não foi possível carregar os chamados."
    });
  }
});

router.get("/support/tickets/:id", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  const ticketId = Number(req.params.id);

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({
      ok: false,
      erro: "Chamado inválido."
    });
  }

  try {
    const ticketResult = await db.query(`
      SELECT
        t.id,
        t.user_id,
        u.name AS user_name,
        u.email AS user_email,
        t.subject,
        t.category,
        t.priority,
        t.status,
        t.created_at,
        t.updated_at,
        t.closed_at
      FROM support_tickets t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.id = $1
      LIMIT 1
    `, [ticketId]);

    if (!ticketResult.rows.length) {
      return res.status(404).json({
        ok: false,
        erro: "Chamado não encontrado."
      });
    }

    const messagesResult = await db.query(`
      SELECT
        id,
        sender_type,
        sender_user_id,
        message,
        created_at
      FROM support_messages
      WHERE ticket_id = $1
      ORDER BY id ASC
    `, [ticketId]);

    return res.json({
      ok: true,
      chamado: ticketResult.rows[0],
      mensagens: messagesResult.rows
    });
  } catch (error) {
    console.error("ADMIN SUPORTE — DETALHE:", error);

    return res.status(500).json({
      ok: false,
      erro: "Não foi possível carregar o chamado."
    });
  }
});

router.post("/support/tickets/:id/messages", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  const ticketId = Number(req.params.id);
  const message = String(
    req.body?.message ||
    req.body?.mensagem ||
    ""
  ).trim();

  const adminUserId = Number(
    req.user?.id ||
    req.user?.userId
  );

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({
      ok: false,
      erro: "Chamado inválido."
    });
  }

  if (!message) {
    return res.status(400).json({
      ok: false,
      erro: "Digite uma mensagem."
    });
  }

  if (message.length > 10000) {
    return res.status(400).json({
      ok: false,
      erro: "Mensagem muito longa."
    });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const ticketResult = await client.query(
      "SELECT id, status FROM support_tickets WHERE id = $1 FOR UPDATE",
      [ticketId]
    );

    if (!ticketResult.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        ok: false,
        erro: "Chamado não encontrado."
      });
    }

    const ticket = ticketResult.rows[0];

    if (ticket.status === "FECHADO") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        ok: false,
        erro: "Este chamado está fechado."
      });
    }

    const messageResult = await client.query(
      `
      INSERT INTO support_messages
        (
          ticket_id,
          sender_type,
          sender_user_id,
          message
        )
      VALUES
        ($1, 'ADMIN', $2, $3)
      RETURNING
        id,
        sender_type,
        sender_user_id,
        message,
        created_at
      `,
      [
        ticketId,
        adminUserId || null,
        message
      ]
    );

    await client.query(
      `
      UPDATE support_tickets
      SET
        status = 'RESPONDIDO',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [ticketId]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      mensagem: "Resposta enviada ao usuário.",
      mensagemChamado: messageResult.rows[0]
    });

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {}

    console.error("ADMIN SUPORTE — RESPONDER:", error);

    return res.status(500).json({
      ok: false,
      erro: "Não foi possível enviar a resposta."
    });

  } finally {
    client.release();
  }
});

router.patch("/support/tickets/:id/status", authMiddleware, async (req, res) => {
  if (!isAdmin(req)) return deny(res);

  const ticketId = Number(req.params.id);
  const status = String(
    req.body?.status || ""
  ).trim().toUpperCase();

  const permitidos = [
    "ABERTO",
    "EM_ATENDIMENTO",
    "RESPONDIDO",
    "FECHADO"
  ];

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({
      ok: false,
      erro: "Chamado inválido."
    });
  }

  if (!permitidos.includes(status)) {
    return res.status(400).json({
      ok: false,
      erro: "Status inválido."
    });
  }

  try {
    const result = await db.query(
      `
      UPDATE support_tickets
      SET
        status = $1,
        updated_at = CURRENT_TIMESTAMP,
        closed_at = CASE
          WHEN $1 = 'FECHADO'
            THEN CURRENT_TIMESTAMP
          ELSE NULL
        END
      WHERE id = $2
      RETURNING
        id,
        user_id,
        subject,
        category,
        priority,
        status,
        created_at,
        updated_at,
        closed_at
      `,
      [
        status,
        ticketId
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        ok: false,
        erro: "Chamado não encontrado."
      });
    }

    return res.json({
      ok: true,
      chamado: result.rows[0]
    });

  } catch (error) {
    console.error("ADMIN SUPORTE — STATUS:", error);

    return res.status(500).json({
      ok: false,
      erro: "Não foi possível atualizar o status."
    });
  }
});


module.exports = router;
