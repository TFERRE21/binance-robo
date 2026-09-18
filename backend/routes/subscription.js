const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");
const Stripe = require("stripe");

const router = express.Router();

// ============================================================
// STRIPE — ÚNICO GATEWAY DE PAGAMENTO
// ============================================================

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;

const BASE_URL =
  process.env.BASE_URL ||
  "https://site--painel-binance--clbfrw28wcz.code.run";

const STRIPE_PRICE_BASICO =
  process.env.STRIPE_PRICE_BASICO;

const STRIPE_PRICE_PROFISSIONAL =
  process.env.STRIPE_PRICE_PROFISSIONAL;

const STRIPE_PRICE_PREMIUM =
  process.env.STRIPE_PRICE_PREMIUM;

// ============================================================
// PLANOS
// ============================================================

const PLANOS = {
  basico: {
    nome: "Básico",
    valor: 49.90,
    operacoesSimultaneas: 1,
    contasBinance: 1,
    robos: 1
  },

  profissional: {
    nome: "Profissional",
    valor: 99.90,
    operacoesSimultaneas: 2,
    contasBinance: 2,
    robos: 2
  },

  premium: {
    nome: "Premium",
    valor: 199.90,
    operacoesSimultaneas: 3,
    contasBinance: 3,
    robos: 5
  }
};

function stripePriceId(plan) {
  const prices = {
    basico: STRIPE_PRICE_BASICO,
    profissional: STRIPE_PRICE_PROFISSIONAL,
    premium: STRIPE_PRICE_PREMIUM
  };

  return prices[plan] || null;
}

// ============================================================
// UTILITÁRIOS
// ============================================================

function getUserId(req) {
  return req.user?.id || req.user?.userId || null;
}

function somenteNumeros(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function adicionarUmMes(data) {
  const novaData = new Date(data);
  novaData.setMonth(novaData.getMonth() + 1);
  return novaData;
}

function getStripeSignature(req) {
  return req.headers["stripe-signature"];
}

// ============================================================
// TESTE DO SERVIÇO
// ============================================================

router.get("/teste", (req, res) => {
  return res.json({
    ok: true,
    service: "subscription",
    provider: "STRIPE"
  });
});

router.get("/teste-stripe", authMiddleware, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({
        ok: false,
        provider: "STRIPE",
        configured: false,
        error: "STRIPE_SECRET_KEY não configurada no servidor."
      });
    }

    const prices = {
      basico: Boolean(STRIPE_PRICE_BASICO),
      profissional: Boolean(STRIPE_PRICE_PROFISSIONAL),
      premium: Boolean(STRIPE_PRICE_PREMIUM)
    };

    return res.json({
      ok: true,
      provider: "STRIPE",
      configured: true,
      prices
    });
  } catch (error) {
    console.error("ERRO TESTE STRIPE:", error);

    return res.status(500).json({
      ok: false,
      error: "Erro ao testar Stripe."
    });
  }
});

// ============================================================
// PLANOS
// ============================================================

router.get("/plans", (req, res) => {
  return res.json({
    ok: true,
    planos: PLANOS
  });
});

// ============================================================
// STRIPE — CHECKOUT
// ============================================================

router.post("/select", authMiddleware, async (req, res) => {
  let subscriptionId = null;

  try {
    if (!stripe) {
      return res.status(500).json({
        ok: false,
        error: "STRIPE_SECRET_KEY não configurada no servidor."
      });
    }

    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Usuário não autenticado."
      });
    }

    const plan = String(req.body?.plan || "")
      .trim()
      .toLowerCase();

    const customerData = req.body?.customerData || {};

    if (!PLANOS[plan]) {
      return res.status(400).json({
        ok: false,
        error: "Plano inválido."
      });
    }

    const priceId = stripePriceId(plan);

    if (!priceId) {
      return res.status(500).json({
        ok: false,
        error:
          `Price ID do plano ${PLANOS[plan].nome} não configurado no servidor.`
      });
    }

    const nome = String(customerData.name || "").trim();
    const email = String(customerData.email || "").trim().toLowerCase();

    const telefone = somenteNumeros(
      customerData.phone ||
      customerData.telefone ||
      customerData.mobilePhone
    );

    if (!nome) {
      return res.status(400).json({
        ok: false,
        error: "Nome é obrigatório."
      });
    }

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "E-mail é obrigatório."
      });
    }

    // --------------------------------------------------------
    // USUÁRIO
    // --------------------------------------------------------

    const userResult = await db.query(
      `
      SELECT id, name, email, active
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Usuário não encontrado."
      });
    }

    const user = userResult.rows[0];

    if (user.active === false) {
      return res.status(403).json({
        ok: false,
        error: "Usuário inativo."
      });
    }

    // --------------------------------------------------------
    // ASSINATURA ATIVA
    // --------------------------------------------------------

    const activeResult = await db.query(
      `
      SELECT *
      FROM subscriptions
      WHERE user_id = $1
        AND status = 'ACTIVE'
      ORDER BY id DESC
      LIMIT 1
      `,
      [userId]
    );

    if (activeResult.rows.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Você já possui uma assinatura ativa."
      });
    }

    // --------------------------------------------------------
    // CHECKOUT STRIPE PENDENTE
    // --------------------------------------------------------

    const pendingResult = await db.query(
      `
      SELECT *
      FROM subscriptions
      WHERE user_id = $1
        AND status = 'PENDING'
        AND payment_provider = 'STRIPE'
        AND plan = $2
      ORDER BY id DESC
      LIMIT 1
      `,
      [userId, plan]
    );

    if (pendingResult.rows.length > 0) {
      const pending = pendingResult.rows[0];

      if (pending.external_payment_id && pending.created_at) {
        const criadoEm = new Date(pending.created_at);
        const minutos =
          (Date.now() - criadoEm.getTime()) / 60000;

        if (Number.isFinite(minutos) && minutos <= 60) {
          try {
            const existingSession =
              await stripe.checkout.sessions.retrieve(
                pending.external_payment_id
              );

            if (
              existingSession &&
              existingSession.status === "open" &&
              existingSession.url
            ) {
              return res.json({
                ok: true,
                provider: "STRIPE",
                plan,
                planName: PLANOS[plan].nome,
                amount: PLANOS[plan].valor,
                subscriptionId: pending.id,
                checkoutId: existingSession.id,
                paymentUrl: existingSession.url,
                reused: true
              });
            }
          } catch (stripeError) {
            console.warn(
              "Não foi possível reutilizar Checkout Stripe pendente:",
              stripeError.message
            );
          }
        }

        await db.query(
          `
          UPDATE subscriptions
          SET status = 'EXPIRED',
              updated_at = NOW()
          WHERE id = $1
            AND status = 'PENDING'
          `,
          [pending.id]
        );
      }
    }

    const plano = PLANOS[plan];

    // --------------------------------------------------------
    // ASSINATURA LOCAL
    // --------------------------------------------------------

    const insertResult = await db.query(
      `
      INSERT INTO subscriptions (
        user_id,
        plan,
        status,
        amount,
        payment_provider,
        payment_method,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'PENDING',
        $3,
        'STRIPE',
        'CREDIT_CARD',
        NOW(),
        NOW()
      )
      RETURNING id
      `,
      [userId, plan, plano.valor]
    );

    subscriptionId = insertResult.rows[0].id;

    // --------------------------------------------------------
    // STRIPE CHECKOUT
    // --------------------------------------------------------

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",

      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],

      customer_email: email,

      client_reference_id: String(subscriptionId),

      metadata: {
        user_id: String(userId),
        subscription_id: String(subscriptionId),
        plan
      },

      subscription_data: {
        metadata: {
          user_id: String(userId),
          subscription_id: String(subscriptionId),
          plan
        }
      },

      success_url:
        `${BASE_URL}/pagamento-sucesso.html?session_id={CHECKOUT_SESSION_ID}`,

      cancel_url:
        `${BASE_URL}/planos.html`,

      payment_method_types: [
        "card"
      ],

      locale: "auto"
    });

    if (!session.id || !session.url) {
      throw new Error(
        "O Stripe não retornou o ID ou URL do checkout."
      );
    }

    console.log("CHECKOUT STRIPE CRIADO:", {
      id: session.id,
      status: session.status,
      plan,
      subscriptionId,
      priceId
    });

    // --------------------------------------------------------
    // SALVAR CHECKOUT
    // --------------------------------------------------------

    await db.query(
      `
      UPDATE subscriptions
      SET
        external_payment_id = $1,
        payment_provider = 'STRIPE',
        payment_method = 'CREDIT_CARD',
        updated_at = NOW()
      WHERE id = $2
      `,
      [session.id, subscriptionId]
    );

    return res.json({
      ok: true,
      provider: "STRIPE",
      plan,
      planName: plano.nome,
      amount: plano.valor,
      subscriptionId,
      checkoutId: session.id,
      paymentUrl: session.url
    });

  } catch (error) {
    console.error("ERRO AO CRIAR CHECKOUT STRIPE:", error);

    if (subscriptionId) {
      try {
        await db.query(
          `
          UPDATE subscriptions
          SET status = 'CANCELLED',
              updated_at = NOW()
          WHERE id = $1
            AND status = 'PENDING'
          `,
          [subscriptionId]
        );
      } catch (dbError) {
        console.error(
          "ERRO AO CANCELAR PENDING STRIPE:",
          dbError
        );
      }
    }

    return res.status(
      error.statusCode ||
      error.status ||
      500
    ).json({
      ok: false,
      error:
        error.message ||
        "Erro ao criar checkout Stripe."
    });
  }
});

// ============================================================
// ALIAS — MANTÉM COMPATIBILIDADE COM FRONTEND
// ============================================================

router.post("/select-stripe", authMiddleware, async (req, res) => {
  // Reaproveita a mesma implementação do endpoint /select.
  // O alias será substituído abaixo pelo mesmo handler.
  return res.status(307).set(
    "Location",
    "/api/subscription/select"
  ).end();
});

// ============================================================
// STATUS DA ASSINATURA
// ============================================================

router.get("/status", authMiddleware, async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Usuário não autenticado."
      });
    }

    // Procura primeiro uma assinatura ACTIVE ainda válida.
    // Registros PENDING/EXPIRED mais recentes não devem bloquear
    // uma assinatura ACTIVE válida do mesmo usuário.
    let result = await db.query(
      `
      SELECT *
      FROM subscriptions
      WHERE user_id = $1
        AND status = 'ACTIVE'
        AND (
          expires_at IS NULL
          OR expires_at > NOW()
        )
      ORDER BY id DESC
      LIMIT 1
      `,
      [userId]
    );

    // Se não houver ACTIVE válida, pega o registro mais recente
    // para informar corretamente o estado ao frontend.
    if (result.rows.length === 0) {
      result = await db.query(
        `
        SELECT *
        FROM subscriptions
        WHERE user_id = $1
        ORDER BY id DESC
        LIMIT 1
        `,
        [userId]
      );
    }

    if (result.rows.length === 0) {
      return res.json({
        ok: true,
        active: false,
        status: "NONE",
        plan: null,
        planName: null,
        amount: 0,
        operacoesSimultaneas: 0,
        contasBinance: 0,
        robos: 0,
        started_at: null,
        expires_at: null,
        expiresAt: null,
        subscriptionId: null,
        paymentProvider: null
      });
    }

    const assinatura = result.rows[0];

    // Proteção adicional contra ACTIVE expirada.
    if (
      assinatura.status === "ACTIVE" &&
      assinatura.expires_at
    ) {
      const expiracao = new Date(assinatura.expires_at);

      if (
        !Number.isNaN(expiracao.getTime()) &&
        expiracao <= new Date()
      ) {
        await db.query(
          `
          UPDATE subscriptions
          SET
            status = 'EXPIRED',
            updated_at = NOW()
          WHERE id = $1
          `,
          [assinatura.id]
        );

        assinatura.status = "EXPIRED";
      }
    }

    const plano = PLANOS[assinatura.plan] || null;

    const active =
      assinatura.status === "ACTIVE" &&
      (
        !assinatura.expires_at ||
        new Date(assinatura.expires_at) > new Date()
      );

    return res.json({
      ok: true,
      active,
      status: active ? "ACTIVE" : assinatura.status,
      plan: assinatura.plan || null,
      planName: plano?.nome || assinatura.plan || null,
      amount: Number(assinatura.amount || 0),
      operacoesSimultaneas:
        plano?.operacoesSimultaneas || 0,
      contasBinance:
        plano?.contasBinance || 0,
      robos:
        plano?.robos || 0,
      started_at:
        assinatura.started_at || null,
      expires_at:
        assinatura.expires_at || null,
      expiresAt:
        assinatura.expires_at || null,
      subscriptionId:
        assinatura.id,
      paymentProvider:
        assinatura.payment_provider || "STRIPE"
    });

  } catch (error) {
    console.error(
      "ERRO AO CONSULTAR ASSINATURA:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Erro ao consultar assinatura."
    });
  }
});

// ============================================================
// WEBHOOK STRIPE
// ============================================================
//
// IMPORTANTE:
// Esta rota precisa receber o corpo RAW da requisição para que
// stripe.webhooks.constructEvent() consiga validar a assinatura.
//
// No server.js, esta rota deve ser registrada ANTES de:
// app.use(express.json())
//
// Exemplo:
// app.post(
//   "/api/subscription/webhook/stripe",
//   express.raw({ type: "application/json" }),
//   subscriptionRouter
// )
//
// Se o router já estiver montado com express.json() antes,
// a assinatura do webhook poderá falhar.
// ============================================================

async function processarWebhookStripe(req, res) {
  if (!stripe) {
    return res.status(500).json({
      ok: false,
      error: "STRIPE_SECRET_KEY não configurada."
    });
  }

  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error(
      "STRIPE_WEBHOOK_SECRET não configurado."
    );

    return res.status(500).json({
      ok: false,
      error: "Webhook Stripe não configurado no servidor."
    });
  }

  const signature = getStripeSignature(req);

  if (!signature) {
    return res.status(400).json({
      ok: false,
      error: "Assinatura Stripe ausente."
    });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret
    );
  } catch (error) {
    console.error(
      "WEBHOOK STRIPE — assinatura inválida:",
      error.message
    );

    return res.status(400).json({
      ok: false,
      error: "Assinatura do webhook inválida."
    });
  }

  console.log(
    "WEBHOOK STRIPE:",
    event.type,
    event.id
  );

  try {
    const object = event.data?.object || {};

    const metadata =
      object.metadata || {};

    const metadataSubscriptionId =
      metadata.subscription_id ||
      null;

    const metadataUserId =
      metadata.user_id ||
      null;

    let subscriptionId =
      metadataSubscriptionId;

    // --------------------------------------------------------
    // checkout.session.completed
    // --------------------------------------------------------

    if (
      event.type === "checkout.session.completed"
    ) {
      if (!subscriptionId && object.client_reference_id) {
        subscriptionId =
          object.client_reference_id;
      }

      if (!subscriptionId) {
        console.warn(
          "Webhook Stripe: subscription_id não encontrado no checkout."
        );

        return res.json({
          ok: true,
          ignored: true
        });
      }

      const localResult = await db.query(
        `
        SELECT *
        FROM subscriptions
        WHERE id = $1
        LIMIT 1
        `,
        [subscriptionId]
      );

      if (localResult.rows.length === 0) {
        console.warn(
          "Webhook Stripe: assinatura local não encontrada:",
          subscriptionId
        );

        return res.json({
          ok: true,
          ignored: true
        });
      }

      const assinatura = localResult.rows[0];

      const stripeSubscriptionId =
        typeof object.subscription === "string"
          ? object.subscription
          : object.subscription?.id || null;

      // Não ativamos aqui somente pela existência da sessão.
      // A confirmação de pagamento/subscription será processada
      // pelos eventos de pagamento abaixo.
      await db.query(
        `
        UPDATE subscriptions
        SET
          external_payment_id =
            COALESCE($1, external_payment_id),
          external_subscription_id =
            COALESCE($2, external_subscription_id),
          updated_at = NOW()
        WHERE id = $3
        `,
        [
          object.id || null,
          stripeSubscriptionId,
          assinatura.id
        ]
      );

      console.log(
        `Checkout Stripe concluído para assinatura local ${assinatura.id}`
      );
    }

    // --------------------------------------------------------
    // invoice.paid
    // --------------------------------------------------------

    else if (event.type === "invoice.paid") {
      let localResult = null;

      // Stripe API 2026+ pode entregar os dados da assinatura
      // dentro de object.parent.subscription_details.
      const invoiceSubscriptionDetails =
        object.parent?.subscription_details || {};

      const invoiceMetadata =
        invoiceSubscriptionDetails.metadata || {};

      // Também verificamos os line items, pois no evento atual
      // eles carregam metadata e a referência da subscription.
      const firstLine =
        Array.isArray(object.lines?.data) &&
        object.lines.data.length > 0
          ? object.lines.data[0]
          : null;

      const lineMetadata =
        firstLine?.metadata || {};

      const lineSubscriptionDetails =
        firstLine?.parent?.subscription_item_details || {};

      // Prioridade:
      // 1) metadata do invoice
      // 2) parent.subscription_details.metadata
      // 3) metadata do line item
      // 4) client_reference_id (se existir)
      subscriptionId =
        subscriptionId ||
        invoiceMetadata.subscription_id ||
        lineMetadata.subscription_id ||
        object.client_reference_id ||
        null;

      // No formato atual do Stripe, a subscription está em:
      // object.parent.subscription_details.subscription
      const stripeSubscriptionId =
        typeof object.subscription === "string"
          ? object.subscription
          : object.subscription?.id ||
            invoiceSubscriptionDetails.subscription ||
            lineSubscriptionDetails.subscription ||
            null;

      if (subscriptionId) {
        localResult = await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE id = $1
          LIMIT 1
          `,
          [subscriptionId]
        );
      }

      if (
        (!localResult || localResult.rows.length === 0) &&
        stripeSubscriptionId
      ) {
        localResult = await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE external_subscription_id = $1
          LIMIT 1
          `,
          [stripeSubscriptionId]
        );
      }

      if (!localResult || localResult.rows.length === 0) {
        console.warn(
          "Webhook Stripe invoice.paid: assinatura não encontrada.",
          {
            subscriptionId,
            stripeSubscriptionId,
            userId:
              metadataUserId ||
              invoiceMetadata.user_id ||
              lineMetadata.user_id ||
              null
          }
        );

        return res.json({
          ok: true,
          ignored: true
        });
      }

      const assinatura = localResult.rows[0];

      const agora = new Date();

      const expiresAt = adicionarUmMes(agora);

      await db.query(
        `
        UPDATE subscriptions
        SET
          status = 'ACTIVE',
          started_at =
            COALESCE(started_at, NOW()),
          expires_at = $1,
          external_subscription_id =
            COALESCE($2, external_subscription_id),
          updated_at = NOW()
        WHERE id = $3
        `,
        [
          expiresAt.toISOString(),
          stripeSubscriptionId,
          assinatura.id
        ]
      );

      console.log(
        `Assinatura ${assinatura.id} ATIVADA via Stripe invoice.paid`
      );
    }

    // --------------------------------------------------------
    // invoice.payment_failed
    // --------------------------------------------------------

    else if (
      event.type === "invoice.payment_failed"
    ) {
      let localResult = null;

      const invoiceSubscriptionDetails =
        object.parent?.subscription_details || {};

      const invoiceMetadata =
        invoiceSubscriptionDetails.metadata || {};

      const firstLine =
        Array.isArray(object.lines?.data) &&
        object.lines.data.length > 0
          ? object.lines.data[0]
          : null;

      const lineMetadata =
        firstLine?.metadata || {};

      const lineSubscriptionDetails =
        firstLine?.parent?.subscription_item_details || {};

      subscriptionId =
        subscriptionId ||
        invoiceMetadata.subscription_id ||
        lineMetadata.subscription_id ||
        object.client_reference_id ||
        null;

      const stripeSubscriptionId =
        typeof object.subscription === "string"
          ? object.subscription
          : object.subscription?.id ||
            invoiceSubscriptionDetails.subscription ||
            lineSubscriptionDetails.subscription ||
            null;

      if (subscriptionId) {
        localResult = await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE id = $1
          LIMIT 1
          `,
          [subscriptionId]
        );
      }

      if (
        (!localResult || localResult.rows.length === 0) &&
        stripeSubscriptionId
      ) {
        localResult = await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE external_subscription_id = $1
          LIMIT 1
          `,
          [stripeSubscriptionId]
        );
      }

      if (localResult && localResult.rows.length > 0) {
        const assinatura = localResult.rows[0];

        await db.query(
          `
          UPDATE subscriptions
          SET
            status = 'PENDING',
            updated_at = NOW()
          WHERE id = $1
          `,
          [assinatura.id]
        );

        console.log(
          `Pagamento Stripe falhou para assinatura ${assinatura.id}`
        );
      }
    }

    // --------------------------------------------------------
    // customer.subscription.deleted
    // --------------------------------------------------------

    else if (
      event.type === "customer.subscription.deleted"
    ) {
      const stripeSubscriptionId =
        object.id || null;

      let localResult = null;

      if (subscriptionId) {
        localResult = await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE id = $1
          LIMIT 1
          `,
          [subscriptionId]
        );
      }

      if (
        (!localResult || localResult.rows.length === 0) &&
        stripeSubscriptionId
      ) {
        localResult = await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE external_subscription_id = $1
          LIMIT 1
          `,
          [stripeSubscriptionId]
        );
      }

      if (localResult && localResult.rows.length > 0) {
        const assinatura = localResult.rows[0];

        await db.query(
          `
          UPDATE subscriptions
          SET
            status = 'CANCELLED',
            updated_at = NOW()
          WHERE id = $1
          `,
          [assinatura.id]
        );

        console.log(
          `Assinatura ${assinatura.id} cancelada via Stripe`
        );
      }
    }

    // --------------------------------------------------------
    // customer.subscription.updated
    // --------------------------------------------------------

    else if (
      event.type === "customer.subscription.updated"
    ) {
      const stripeSubscriptionId =
        object.id || null;

      let localResult = null;

      if (subscriptionId) {
        localResult = await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE id = $1
          LIMIT 1
          `,
          [subscriptionId]
        );
      }

      if (
        (!localResult || localResult.rows.length === 0) &&
        stripeSubscriptionId
      ) {
        localResult = await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE external_subscription_id = $1
          LIMIT 1
          `,
          [stripeSubscriptionId]
        );
      }

      if (localResult && localResult.rows.length > 0) {
        const assinatura = localResult.rows[0];

        const stripeStatus =
          object.status;

        if (
          stripeStatus === "canceled" ||
          stripeStatus === "unpaid"
        ) {
          await db.query(
            `
            UPDATE subscriptions
            SET
              status = 'CANCELLED',
              updated_at = NOW()
            WHERE id = $1
            `,
            [assinatura.id]
          );
        } else if (
          stripeStatus === "active"
        ) {
          await db.query(
            `
            UPDATE subscriptions
            SET
              status = 'ACTIVE',
              external_subscription_id =
                COALESCE($1, external_subscription_id),
              updated_at = NOW()
            WHERE id = $2
            `,
            [
              stripeSubscriptionId,
              assinatura.id
            ]
          );
        }
      }
    }

    return res.json({
      ok: true,
      received: true,
      event: event.type
    });

  } catch (error) {
    console.error(
      "ERRO AO PROCESSAR WEBHOOK STRIPE:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Erro interno ao processar webhook Stripe."
    });
  }
}

// ============================================================
// ROTA WEBHOOK
// ============================================================

router.post(
  "/webhook/stripe",
  processarWebhookStripe
);

// ============================================================
// ALIAS / COMPATIBILIDADE
// ============================================================

router.get("/teste-mercadopago", (req, res) => {
  return res.json({
    ok: true,
    message: "Gateway antigo não utilizado. Stripe é o gateway atual.",
    provider: "STRIPE"
  });
});

module.exports = router;
