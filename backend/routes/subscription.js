const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

const ASAAS_API_URL =
  process.env.ASAAS_API_URL || "https://api.asaas.com/v3";

const ASAAS_API_KEY =
  process.env.ASAAS_API_KEY;

const ASAAS_WEBHOOK_TOKEN =
  process.env.ASAAS_WEBHOOK_TOKEN;

const BASE_URL =
  process.env.BASE_URL ||
  "https://site--painel-binance--clbfrw28wcz.code.run";

// ============================================================
// PLANOS
// ============================================================

const PLANOS = {
  basico: {
    nome: "Básico",
    valor: 49.90,
    operacoesSimultaneas: 1,
    contasBinance: 1
  },

  profissional: {
    nome: "Profissional",
    valor: 99.90,
    operacoesSimultaneas: 2,
    contasBinance: 2
  },

  premium: {
    nome: "Premium",
    valor: 199.90,
    operacoesSimultaneas: 3,
    contasBinance: 3
  }
};

// ============================================================
// ASAAS
// ============================================================

async function asaasRequest(endpoint, options = {}) {
  if (!ASAAS_API_KEY) {
    throw new Error("ASAAS_API_KEY não configurada no servidor.");
  }

  const response = await fetch(
    `${ASAAS_API_URL}${endpoint}`,
    {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "access_token": ASAAS_API_KEY,
        ...(options.headers || {})
      },
      body: options.body || undefined
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    console.error("ERRO API ASAAS:", {
      status: response.status,
      endpoint,
      data
    });

    const error = new Error(
      data?.errors?.[0]?.description ||
      data?.message ||
      `Erro Asaas HTTP ${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

// ============================================================
// UTILITÁRIOS
// ============================================================

function somenteNumeros(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function dataAsaas() {
  const data = new Date();
  data.setDate(data.getDate() + 1);
  return data.toISOString().slice(0, 10);
}

function adicionarUmMes(data) {
  const novaData = new Date(data);
  novaData.setMonth(novaData.getMonth() + 1);
  return novaData;
}

function gerarLinkCheckout(checkoutId) {
  return `https://asaas.com/checkoutSession/show?id=${encodeURIComponent(checkoutId)}`;
}

// ============================================================
// TESTE
// ============================================================

router.get("/teste", (req, res) => {
  return res.json({
    ok: true,
    service: "subscription",
    provider: "ASAAS"
  });
});

// ============================================================
// COMPATIBILIDADE MERCADO PAGO
// ============================================================

router.get("/teste-mercadopago", (req, res) => {
  return res.json({
    ok: true,
    message: "Rota antiga mantida apenas para compatibilidade.",
    provider: "MERCADO_PAGO"
  });
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
// SELECIONAR PLANO
// ============================================================

router.post("/select", authMiddleware, async (req, res) => {
  let subscriptionId = null;

  try {
    const userId =
      req.user?.id ||
      req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Usuário não autenticado."
      });
    }

    const plan =
      String(req.body?.plan || "")
        .trim()
        .toLowerCase();

    const customerData =
      req.body?.customerData || {};

    if (!PLANOS[plan]) {
      return res.status(400).json({
        ok: false,
        error: "Plano inválido."
      });
    }

    const nome =
      String(customerData.name || "")
        .trim();

    const email =
      String(customerData.email || "")
        .trim();

    const cpfCnpj =
      somenteNumeros(
        customerData.cpfCnpj ||
        customerData.cpf ||
        customerData.cnpj
      );

    const telefone =
      somenteNumeros(
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

    if (!cpfCnpj) {
      return res.status(400).json({
        ok: false,
        error: "CPF/CNPJ é obrigatório."
      });
    }

    if (!telefone) {
      return res.status(400).json({
        ok: false,
        error: "Telefone é obrigatório."
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
    // CHECKOUT PENDENTE RECENTE
    // --------------------------------------------------------

    const pendingResult = await db.query(
      `
      SELECT *
      FROM subscriptions
      WHERE user_id = $1
        AND status = 'PENDING'
        AND payment_provider = 'ASAAS'
      ORDER BY id DESC
      LIMIT 1
      `,
      [userId]
    );

    if (pendingResult.rows.length > 0) {
      const pending = pendingResult.rows[0];

      if (
        pending.external_payment_id &&
        pending.created_at
      ) {
        const criadoEm =
          new Date(pending.created_at);

        const minutos =
          (Date.now() - criadoEm.getTime()) / 60000;

        if (Number.isFinite(minutos) && minutos <= 60) {
          return res.json({
            ok: true,
            paymentUrl:
              gerarLinkCheckout(
                pending.external_payment_id
              ),
            checkoutId:
              pending.external_payment_id,
            subscriptionId:
              pending.id,
            reused: true
          });
        }

        await db.query(
          `
          UPDATE subscriptions
          SET status = 'EXPIRED',
              updated_at = NOW()
          WHERE id = $1
          `,
          [pending.id]
        );
      }
    }

    const plano = PLANOS[plan];

    // --------------------------------------------------------
    // CRIAR ASSINATURA LOCAL
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
        'ASAAS',
        'CREDIT_CARD',
        NOW(),
        NOW()
      )
      RETURNING id
      `,
      [
        userId,
        plan,
        plano.valor
      ]
    );

    subscriptionId =
      insertResult.rows[0].id;

    // --------------------------------------------------------
    // CHECKOUT ASAAS
    // --------------------------------------------------------

    const checkoutPayload = {
      billingTypes: [
        "CREDIT_CARD"
      ],

      chargeTypes: [
        "RECURRENT"
      ],

      minutesToExpire: 60,

      externalReference:
        String(subscriptionId),

      callback: {
        successUrl:
          `${BASE_URL}/pagamento-sucesso.html`,

        cancelUrl:
          `${BASE_URL}/planos.html`,

        expiredUrl:
          `${BASE_URL}/planos.html`
      },

      items: [
        {
          name:
            `CriptoPro ${plano.nome}`,

          description:
            `Assinatura mensal CriptoPro ${plano.nome}`,

          quantity: 1,

          value:
            plano.valor
        }
      ],

      // IMPORTANTE:
      // No Checkout do Asaas o campo correto é "phone".
      customerData: {
        name:
          nome,

        email:
          email,

        cpfCnpj:
          cpfCnpj,

        phone:
          telefone
      },

      subscription: {
        cycle:
          "MONTHLY",

        nextDueDate:
          dataAsaas()
      }
    };

    console.log(
      "CRIANDO CHECKOUT ASAAS:",
      {
        plan,
        subscriptionId,
        customerData: {
          name: nome,
          email,
          cpfCnpj,
          phone: telefone
        }
      }
    );

    const checkout =
      await asaasRequest(
        "/checkouts",
        {
          method: "POST",
          body:
            JSON.stringify(
              checkoutPayload
            )
        }
      );

    console.log(
      "CHECKOUT ASAAS CRIADO:",
      {
        id:
          checkout.id,

        status:
          checkout.status,

        link:
          checkout.link
      }
    );

    if (!checkout.id) {
      throw new Error(
        "O Asaas não retornou o ID do checkout."
      );
    }

    // --------------------------------------------------------
    // SALVAR CHECKOUT
    // --------------------------------------------------------

    await db.query(
      `
      UPDATE subscriptions
      SET
        external_payment_id = $1,
        payment_provider = 'ASAAS',
        payment_method = 'CREDIT_CARD',
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        checkout.id,
        subscriptionId
      ]
    );

    // --------------------------------------------------------
    // RESPOSTA
    // --------------------------------------------------------

    return res.json({
      ok: true,
      plan,
      planName:
        plano.nome,
      amount:
        plano.valor,
      subscriptionId,
      checkoutId:
        checkout.id,
      paymentUrl:
        gerarLinkCheckout(
          checkout.id
        )
    });

  } catch (error) {
    console.error(
      "ERRO AO SELECIONAR PLANO:",
      error
    );

    // Se criamos uma assinatura local mas
    // o checkout falhou, ela não deve ficar
    // eternamente como PENDING.
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
          "ERRO AO CANCELAR PENDING APÓS FALHA:",
          dbError
        );
      }
    }

    return res.status(
      error.status || 500
    ).json({
      ok: false,
      error:
        error.message ||
        "Erro ao criar checkout."
    });
  }
});

// ============================================================
// STATUS
// ============================================================

router.get("/status", authMiddleware, async (req, res) => {
  try {
    const userId =
      req.user?.id ||
      req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Usuário não autenticado."
      });
    }

    const result = await db.query(
      `
      SELECT *
      FROM subscriptions
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        ok: true,
        active: false,
        status: "NONE"
      });
    }

    const assinatura =
      result.rows[0];

    if (
      assinatura.status === "ACTIVE" &&
      assinatura.expires_at
    ) {
      const expiracao =
        new Date(
          assinatura.expires_at
        );

      if (
        expiracao <= new Date()
      ) {
        await db.query(
          `
          UPDATE subscriptions
          SET status = 'EXPIRED',
              updated_at = NOW()
          WHERE id = $1
          `,
          [assinatura.id]
        );

        assinatura.status =
          "EXPIRED";
      }
    }

    const plano =
      PLANOS[assinatura.plan];

    return res.json({
      ok: true,

      active:
        assinatura.status ===
        "ACTIVE",

      status:
        assinatura.status,

      plan:
        assinatura.plan,

      planName:
        plano?.nome ||
        assinatura.plan,

      amount:
        assinatura.amount,

      operacoesSimultaneas:
        plano?.operacoesSimultaneas ||
        0,

      contasBinance:
        plano?.contasBinance ||
        0,

      started_at:
        assinatura.started_at,

      expires_at:
        assinatura.expires_at,

      subscriptionId:
        assinatura.id
    });

  } catch (error) {
    console.error(
      "ERRO AO CONSULTAR ASSINATURA:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "Erro ao consultar assinatura."
    });
  }
});

// ============================================================
// LOCALIZAR ASSINATURA PELO EVENTO ASAAS
// ============================================================

async function encontrarAssinaturaLocal(evento) {
  const payment =
    evento?.payment || {};

  const checkout =
    evento?.checkout || {};

  const subscription =
    evento?.subscription || {};

  const externalReference =
    checkout.externalReference ||
    payment.externalReference ||
    subscription.externalReference;

  const checkoutId =
    checkout.id;

  const asaasSubscriptionId =
    subscription.id ||
    payment.subscription;

  // ----------------------------------------------------------
  // 1. EXTERNAL REFERENCE
  // ----------------------------------------------------------

  if (externalReference) {
    const result =
      await db.query(
        `
        SELECT *
        FROM subscriptions
        WHERE id = $1
        LIMIT 1
        `,
        [externalReference]
      );

    if (result.rows.length > 0) {
      return result.rows[0];
    }
  }

  // ----------------------------------------------------------
  // 2. CHECKOUT ID
  // ----------------------------------------------------------

  if (checkoutId) {
    const result =
      await db.query(
        `
        SELECT *
        FROM subscriptions
        WHERE external_payment_id = $1
        LIMIT 1
        `,
        [checkoutId]
      );

    if (result.rows.length > 0) {
      return result.rows[0];
    }
  }

  // ----------------------------------------------------------
  // 3. ASSINATURA ASAAS
  // ----------------------------------------------------------

  if (asaasSubscriptionId) {
    const result =
      await db.query(
        `
        SELECT *
        FROM subscriptions
        WHERE external_subscription_id = $1
        LIMIT 1
        `,
        [asaasSubscriptionId]
      );

    if (result.rows.length > 0) {
      return result.rows[0];
    }
  }

  return null;
}

// ============================================================
// PROCESSAR WEBHOOK ASAAS
// ============================================================

async function processarWebhookAsaas(req, res) {
  try {
    const tokenRecebido =
      req.headers["asaas-access-token"];

    if (
      !ASAAS_WEBHOOK_TOKEN ||
      tokenRecebido !== ASAAS_WEBHOOK_TOKEN
    ) {
      console.warn(
        "Webhook Asaas recusado: token inválido."
      );

      return res.status(401).json({
        ok: false,
        error: "Não autorizado."
      });
    }

    const evento =
      req.body || {};

    console.log(
      "WEBHOOK ASAAS:",
      evento.event
    );

    const assinatura =
      await encontrarAssinaturaLocal(
        evento
      );

    if (!assinatura) {
      console.warn(
        "Assinatura local não encontrada:",
        {
          event:
            evento.event,

          payment:
            evento.payment?.id,

          checkout:
            evento.checkout?.id,

          subscription:
            evento.subscription?.id ||
            evento.payment?.subscription
        }
      );

      return res.json({
        ok: true,
        ignored: true
      });
    }

    const event =
      evento.event;

    // ========================================================
    // CHECKOUT PAGO
    // ========================================================

    if (
      event === "CHECKOUT_PAID"
    ) {
      const agora =
        new Date();

      const expiresAt =
        assinatura.expires_at
          ? new Date(
              assinatura.expires_at
            )
          : adicionarUmMes(
              agora
            );

      const asaasSubscriptionId =
        evento.subscription?.id ||
        evento.checkout?.subscription ||
        null;

      await db.query(
        `
        UPDATE subscriptions
        SET
          status = 'ACTIVE',
          started_at =
            COALESCE(
              started_at,
              NOW()
            ),
          expires_at = $1,
          external_subscription_id =
            COALESCE(
              $2,
              external_subscription_id
            ),
          updated_at = NOW()
        WHERE id = $3
        `,
        [
          expiresAt.toISOString(),
          asaasSubscriptionId,
          assinatura.id
        ]
      );

      console.log(
        `Assinatura ${assinatura.id} ativada via CHECKOUT_PAID`
      );
    }

    // ========================================================
    // ASSINATURA CRIADA
    // ========================================================

    else if (
      event === "SUBSCRIPTION_CREATED"
    ) {
      const asaasSubscriptionId =
        evento.subscription?.id;

      if (asaasSubscriptionId) {
        await db.query(
          `
          UPDATE subscriptions
          SET
            external_subscription_id = $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [
            asaasSubscriptionId,
            assinatura.id
          ]
        );

        console.log(
          `Assinatura Asaas ${asaasSubscriptionId} vinculada à local ${assinatura.id}`
        );
      }
    }

    // ========================================================
    // PAGAMENTO RECEBIDO
    // ========================================================

    else if (
      event === "PAYMENT_RECEIVED"
    ) {
      const payment =
        evento.payment || {};

      const dueDate =
        payment.dueDate;

      const novaData =
        dueDate
          ? adicionarUmMes(
              new Date(dueDate)
            )
          : adicionarUmMes(
              new Date()
            );

      const atual =
        assinatura.expires_at
          ? new Date(
              assinatura.expires_at
            )
          : null;

      const novaDataFinal =
        !atual ||
        novaData > atual
          ? novaData
          : atual;

      await db.query(
        `
        UPDATE subscriptions
        SET
          status = 'ACTIVE',
          expires_at = $1,
          external_subscription_id =
            COALESCE(
              $2,
              external_subscription_id
            ),
          updated_at = NOW()
        WHERE id = $3
        `,
        [
          novaDataFinal.toISOString(),
          payment.subscription || null,
          assinatura.id
        ]
      );

      console.log(
        `Pagamento recebido para assinatura ${assinatura.id}`
      );
    }

    // ========================================================
    // PAGAMENTO CONFIRMADO
    // ========================================================

    else if (
      event === "PAYMENT_CONFIRMED"
    ) {
      // Mantido como fallback.
      // O CHECKOUT_PAID é o evento usado
      // para ativar a contratação inicial.

      if (
        assinatura.status ===
        "PENDING"
      ) {
        const expiresAt =
          assinatura.expires_at
            ? new Date(
                assinatura.expires_at
              )
            : adicionarUmMes(
                new Date()
              );

        await db.query(
          `
          UPDATE subscriptions
          SET
            status = 'ACTIVE',
            started_at =
              COALESCE(
                started_at,
                NOW()
              ),
            expires_at = $1,
            external_subscription_id =
              COALESCE(
                $2,
                external_subscription_id
              ),
            updated_at = NOW()
          WHERE id = $3
          `,
          [
            expiresAt.toISOString(),
            evento.payment?.subscription ||
              null,
            assinatura.id
          ]
        );

        console.log(
          `Pagamento confirmado para assinatura ${assinatura.id}`
        );
      }
    }

    // ========================================================
    // PAGAMENTO EM ATRASO
    // ========================================================

    else if (
      event === "PAYMENT_OVERDUE"
    ) {
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
        `Pagamento em atraso: assinatura ${assinatura.id}`
      );
    }

    // ========================================================
    // CHECKOUT CANCELADO
    // ========================================================

    else if (
      event === "CHECKOUT_CANCELED"
    ) {
      await db.query(
        `
        UPDATE subscriptions
        SET
          status = 'CANCELLED',
          updated_at = NOW()
        WHERE id = $1
          AND status = 'PENDING'
        `,
        [assinatura.id]
      );
    }

    // ========================================================
    // CHECKOUT EXPIRADO
    // ========================================================

    else if (
      event === "CHECKOUT_EXPIRED"
    ) {
      await db.query(
        `
        UPDATE subscriptions
        SET
          status = 'EXPIRED',
          updated_at = NOW()
        WHERE id = $1
          AND status = 'PENDING'
        `,
        [assinatura.id]
      );
    }

    // ========================================================
    // ASSINATURA INATIVADA / EXCLUÍDA
    // ========================================================

    else if (
      event ===
        "SUBSCRIPTION_INACTIVATED" ||
      event ===
        "SUBSCRIPTION_DELETED"
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

      console.log(
        `Assinatura ${assinatura.id} cancelada`
      );
    }

    // ========================================================
    // ESTORNO / CHARGEBACK
    // ========================================================

    else if (
      event ===
        "PAYMENT_REFUNDED" ||
      event ===
        "PAYMENT_CHARGEBACK_REQUESTED"
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

      console.log(
        `Pagamento estornado/chargeback: ${assinatura.id}`
      );
    }

    else {
      console.log(
        `Evento Asaas sem ação específica: ${event}`
      );
    }

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error(
      "ERRO AO PROCESSAR WEBHOOK ASAAS:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "Erro interno ao processar webhook."
    });
  }
}

// ============================================================
// WEBHOOK PRINCIPAL
// ============================================================

router.post(
  "/webhook/asaas",
  processarWebhookAsaas
);

// ============================================================
// ALIAS
// ============================================================

router.post(
  "/webhook",
  processarWebhookAsaas
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
