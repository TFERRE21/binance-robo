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
// ASAAS — PIX / CHECKOUT AVULSO
// ============================================================
//
// A chave da API e o token do Webhook ficam somente no backend.
// O frontend nunca recebe ASAAS_API_KEY.
//
// ASAAS_BASE_URL pode ser definido para Sandbox ou Produção.
// Padrão: Produção.
//
// ============================================================

const ASAAS_API_KEY =
  process.env.ASAAS_API_KEY || "";

const ASAAS_WEBHOOK_TOKEN =
  process.env.ASAAS_WEBHOOK_TOKEN || "";

const ASAAS_BASE_URL =
  process.env.ASAAS_BASE_URL ||
  (
    String(process.env.ASAAS_ENV || "").toLowerCase() === "sandbox"
      ? "https://api-sandbox.asaas.com"
      : "https://api.asaas.com"
  );



// ============================================================
// TESTE ASAAS
// ============================================================

router.get(
  "/teste-asaas",
  authMiddleware,
  async (req, res) => {

    try {

      if (!ASAAS_API_KEY) {
        return res.json({
          ok: true,
          provider: "ASAAS",
          configured: false,
          baseUrl:
            ASAAS_BASE_URL
        });
      }

      // Consulta simples à conta autenticada.
      // Não expõe a API Key.
      const account =
        await asaasRequest(
          "/v3/myAccount"
        );

      return res.json({
        ok: true,
        provider: "ASAAS",
        configured: true,
        baseUrl:
          ASAAS_BASE_URL,
        accountId:
          account?.id ||
          null,
        accountName:
          account?.name ||
          null
      });

    } catch (error) {

      console.error(
        "ERRO TESTE ASAAS:",
        error
      );

      return res.status(
        error?.status || 500
      ).json({
        ok: false,
        provider: "ASAAS",
        configured:
          Boolean(ASAAS_API_KEY),
        baseUrl:
          ASAAS_BASE_URL,
        error:
          error?.message ||
          "Erro ao testar Asaas."
      });
    }
  }
);

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


// ============================================================
// ASAAS — UTILITÁRIOS
// ============================================================

function asaasConfigured() {
  return Boolean(ASAAS_API_KEY);
}

async function asaasRequest(path, options = {}) {
  if (!ASAAS_API_KEY) {
    const error = new Error(
      "ASAAS_API_KEY não configurada no servidor."
    );
    error.status = 500;
    throw error;
  }

  const response = await fetch(
    `${ASAAS_BASE_URL}${path}`,
    {
      method: options.method || "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        access_token: ASAAS_API_KEY,
        ...(options.headers || {})
      },
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
    }
  );

  const raw = await response.text();

  let data = null;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {
      message: raw || "Resposta inválida do Asaas."
    };
  }

  if (!response.ok) {
    const descriptions = Array.isArray(data?.errors)
      ? data.errors
          .map((item) =>
            item?.description ||
            item?.code ||
            null
          )
          .filter(Boolean)
          .join("; ")
      : "";

    const error = new Error(
      descriptions ||
      data?.message ||
      `Asaas HTTP ${response.status}`
    );

    error.status = response.status;
    error.asaas = data;

    throw error;
  }

  return data;
}

async function cancelarAssinaturaAnterior(assinatura) {
  if (!assinatura) {
    return {
      ok: true,
      skipped: true
    };
  }

  try {
    if (
      assinatura.payment_provider === "ASAAS" &&
      assinatura.external_subscription_id
    ) {
      await asaasRequest(
        `/v3/subscriptions/${encodeURIComponent(
          assinatura.external_subscription_id
        )}`,
        {
          method: "DELETE"
        }
      );

      console.log(
        "ASSINATURA ASAAS ANTERIOR ENCERRADA:",
        {
          localSubscriptionId:
            assinatura.id,
          asaasSubscriptionId:
            assinatura.external_subscription_id
        }
      );

      return {
        ok: true,
        provider: "ASAAS"
      };
    }

    if (
      assinatura.payment_provider === "STRIPE" &&
      assinatura.external_subscription_id &&
      stripe
    ) {
      await stripe.subscriptions.cancel(
        assinatura.external_subscription_id
      );

      console.log(
        "ASSINATURA STRIPE ANTERIOR ENCERRADA APÓS UPGRADE ASAAS:",
        {
          localSubscriptionId:
            assinatura.id,
          stripeSubscriptionId:
            assinatura.external_subscription_id
        }
      );

      return {
        ok: true,
        provider: "STRIPE"
      };
    }

    return {
      ok: true,
      skipped: true,
      reason:
        "Assinatura anterior sem identificador externo cancelável."
    };

  } catch (error) {
    console.error(
      "NÃO FOI POSSÍVEL ENCERRAR A ASSINATURA ANTERIOR:",
      {
        localSubscriptionId:
          assinatura.id,
        provider:
          assinatura.payment_provider,
        externalSubscriptionId:
          assinatura.external_subscription_id,
        error:
          error?.message || String(error)
      }
    );

    return {
      ok: false,
      error:
        error?.message || String(error)
    };
  }
}

function asaasExternalReference(
  subscriptionId,
  previousSubscriptionId = null
) {
  if (previousSubscriptionId) {
    return `criptopro:${subscriptionId}:upgrade:${previousSubscriptionId}`;
  }

  return `criptopro:${subscriptionId}`;
}

function subscriptionIdFromAsaasReference(reference) {
  const value = String(reference || "").trim();

  if (!value.startsWith("criptopro:")) {
    return null;
  }

  const match = value.match(
    /^criptopro:(\d+)(?::upgrade:\d+)?$/
  );

  return match
    ? Number(match[1])
    : null;
}

function previousSubscriptionIdFromAsaasReference(reference) {
  const value = String(reference || "").trim();

  const match = value.match(
    /^criptopro:\d+:upgrade:(\d+)$/
  );

  return match
    ? Number(match[1])
    : null;
}

function asaasCheckoutPaymentId(checkoutId) {
  return `ASAAS_CHECKOUT:${checkoutId}`;
}

function asaasCheckoutLink(checkout) {
  return (
    checkout?.link ||
    (
      checkout?.id
        ? `https://asaas.com/checkoutSession/show?id=${encodeURIComponent(checkout.id)}`
        : null
    )
  );
}

function dataHojeISO() {
  const agora = new Date();

  const ano =
    agora.getFullYear();

  const mes =
    String(
      agora.getMonth() + 1
    ).padStart(2, "0");

  const dia =
    String(
      agora.getDate()
    ).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

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
// DETECTA ASSINATURA DE TESTE USADA EM AMBIENTE LIVE
// ============================================================
//
// Quando uma assinatura TEST é consultada usando uma chave LIVE,
// o Stripe retorna:
//
// "No such subscription ... a similar object exists in test mode,
// but a live mode key was used to make this request."
//
// Nessa situação NÃO devemos tentar atualizar a assinatura antiga.
// Vamos criar uma nova assinatura LIVE através do Checkout.
//
// ============================================================

function assinaturaStripeDeOutroModo(error) {
  const mensagem = String(error?.message || "");

  return (
    error?.code === "resource_missing" &&
    (
      /test mode/i.test(mensagem) ||
      /live mode key/i.test(mensagem) ||
      /similar object exists in test mode/i.test(mensagem)
    )
  );
}

// ============================================================
// CRIA CHECKOUT LIVE PARA TROCA DE PLANO
// ============================================================
//
// Usado quando a assinatura local antiga existe, mas o Stripe
// informa que o ID pertence ao ambiente TEST.
//
// A assinatura antiga permanece ativa até o novo pagamento LIVE
// ser confirmado pelo webhook.
//
// ============================================================

async function criarCheckoutLiveParaTroca({
  userId,
  assinaturaAntiga,
  planoNovo,
  email,
  nome
}) {
  const priceId = stripePriceId(planoNovo);

  if (!priceId) {
    throw new Error(
      `Price ID do plano ${PLANOS[planoNovo].nome} não configurado no servidor.`
    );
  }

  // ----------------------------------------------------------
  // Verifica se já existe um checkout PENDING recente para
  // evitar gerar vários pagamentos para a mesma troca.
  // ----------------------------------------------------------

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
    [userId, planoNovo]
  );

  if (pendingResult.rows.length > 0) {
    const pending = pendingResult.rows[0];

    if (
      pending.external_payment_id &&
      pending.created_at
    ) {
      const criadoEm = new Date(
        pending.created_at
      );

      const minutos =
        (Date.now() - criadoEm.getTime()) / 60000;

      if (
        Number.isFinite(minutos) &&
        minutos <= 60
      ) {
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
            return {
              subscriptionId: pending.id,
              checkoutId: existingSession.id,
              paymentUrl: existingSession.url,
              reused: true
            };
          }
        } catch (error) {
          console.warn(
            "Não foi possível reutilizar checkout de troca:",
            error.message
          );
        }
      }
    }

    await db.query(
      `
      UPDATE subscriptions
      SET
        status = 'EXPIRED',
        updated_at = NOW()
      WHERE id = $1
        AND status = 'PENDING'
      `,
      [pending.id]
    );
  }

  // ----------------------------------------------------------
  // CRIA NOVA ASSINATURA LOCAL PENDING
  // ----------------------------------------------------------
  //
  // A antiga continua ACTIVE até o novo pagamento ser confirmado.
  //

  const novoPlano = PLANOS[planoNovo];

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
    [
      userId,
      planoNovo,
      novoPlano.valor
    ]
  );

  const novaSubscriptionId =
    insertResult.rows[0].id;

  // ----------------------------------------------------------
  // CHECKOUT STRIPE LIVE
  // ----------------------------------------------------------

  const session =
    await stripe.checkout.sessions.create({
      mode: "subscription",

      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],

      customer_email: email,

      client_reference_id:
        String(novaSubscriptionId),

      metadata: {
        user_id: String(userId),
        subscription_id:
          String(novaSubscriptionId),

        previous_subscription_id:
          String(assinaturaAntiga.id),

        previous_plan:
          String(assinaturaAntiga.plan),

        plan:
          String(planoNovo),

        migration_from_other_stripe_mode:
          "true"
      },

      subscription_data: {
        metadata: {
          user_id: String(userId),

          subscription_id:
            String(novaSubscriptionId),

          previous_subscription_id:
            String(assinaturaAntiga.id),

          previous_plan:
            String(assinaturaAntiga.plan),

          plan:
            String(planoNovo),

          migration_from_other_stripe_mode:
            "true"
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

  if (
    !session.id ||
    !session.url
  ) {
    throw new Error(
      "O Stripe não retornou o ID ou URL do checkout LIVE."
    );
  }

  // ----------------------------------------------------------
  // SALVA CHECKOUT
  // ----------------------------------------------------------

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
    [
      session.id,
      novaSubscriptionId
    ]
  );

  console.log(
    "CHECKOUT LIVE DE TROCA DE PLANO CRIADO:",
    {
      sessionId: session.id,
      localSubscriptionId:
        novaSubscriptionId,
      previousSubscriptionId:
        assinaturaAntiga.id,
      previousPlan:
        assinaturaAntiga.plan,
      newPlan:
        planoNovo,
      priceId
    }
  );

  return {
    subscriptionId:
      novaSubscriptionId,

    checkoutId:
      session.id,

    paymentUrl:
      session.url,

    reused: false
  };
}

// ============================================================
// TESTE DO SERVIÇO
// ============================================================

router.get("/teste", (req, res) => {
  return res.json({
    ok: true,
    service: "subscription",
    providers: ["STRIPE", "ASAAS"],
    asaasConfigured: asaasConfigured()
  });
});

// ============================================================
// TESTE STRIPE
// ============================================================

router.get(
  "/teste-stripe",
  authMiddleware,
  async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({
          ok: false,
          provider: "STRIPE",
          configured: false,
          error:
            "STRIPE_SECRET_KEY não configurada no servidor."
        });
      }

      const prices = {
        basico:
          Boolean(STRIPE_PRICE_BASICO),

        profissional:
          Boolean(STRIPE_PRICE_PROFISSIONAL),

        premium:
          Boolean(STRIPE_PRICE_PREMIUM)
      };

      return res.json({
        ok: true,
        provider: "STRIPE",
        configured: true,
        prices,

        // IMPORTANTE:
        // Este endpoint não expõe a chave.
        mode:
          String(
            STRIPE_SECRET_KEY || ""
          ).startsWith("sk_live_")
            ? "LIVE"
            : "TEST"
      });

    } catch (error) {
      console.error(
        "ERRO TESTE STRIPE:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Erro ao testar Stripe."
      });
    }
  }
);

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
// STRIPE — CHECKOUT NORMAL
// ============================================================

router.post(
  "/select",
  authMiddleware,
  async (req, res) => {

    let subscriptionId = null;

    try {

      if (!stripe) {
        return res.status(500).json({
          ok: false,
          error:
            "STRIPE_SECRET_KEY não configurada no servidor."
        });
      }

      const userId =
        getUserId(req);

      if (!userId) {
        return res.status(401).json({
          ok: false,
          error:
            "Usuário não autenticado."
        });
      }

      const plan =
        String(
          req.body?.plan || ""
        )
        .trim()
        .toLowerCase();

      const customerData =
        req.body?.customerData || {};

      if (!PLANOS[plan]) {
        return res.status(400).json({
          ok: false,
          error:
            "Plano inválido."
        });
      }

      const priceId =
        stripePriceId(plan);

      if (!priceId) {
        return res.status(500).json({
          ok: false,
          error:
            `Price ID do plano ${PLANOS[plan].nome} não configurado no servidor.`
        });
      }

      const nome =
        String(
          customerData.name || ""
        ).trim();

      const email =
        String(
          customerData.email || ""
        )
        .trim()
        .toLowerCase();

      const telefone =
        somenteNumeros(
          customerData.phone ||
          customerData.telefone ||
          customerData.mobilePhone
        );

      if (!nome) {
        return res.status(400).json({
          ok: false,
          error:
            "Nome é obrigatório."
        });
      }

      if (!email) {
        return res.status(400).json({
          ok: false,
          error:
            "E-mail é obrigatório."
        });
      }

      // ------------------------------------------------------
      // USUÁRIO
      // ------------------------------------------------------

      const userResult =
        await db.query(
          `
          SELECT id, name, email, active
          FROM users
          WHERE id = $1
          LIMIT 1
          `,
          [userId]
        );

      if (
        userResult.rows.length === 0
      ) {
        return res.status(404).json({
          ok: false,
          error:
            "Usuário não encontrado."
        });
      }

      const user =
        userResult.rows[0];

      if (user.active === false) {
        return res.status(403).json({
          ok: false,
          error:
            "Usuário inativo."
        });
      }

      // ------------------------------------------------------
      // ASSINATURA ATIVA
      // ------------------------------------------------------

      const activeResult =
        await db.query(
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

      if (
        activeResult.rows.length > 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Você já possui uma assinatura ativa."
        });
      }

      // ------------------------------------------------------
      // CHECKOUT STRIPE PENDENTE
      // ------------------------------------------------------

      const pendingResult =
        await db.query(
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
          [
            userId,
            plan
          ]
        );

      if (
        pendingResult.rows.length > 0
      ) {

        const pending =
          pendingResult.rows[0];

        if (
          pending.external_payment_id &&
          pending.created_at
        ) {

          const criadoEm =
            new Date(
              pending.created_at
            );

          const minutos =
            (
              Date.now() -
              criadoEm.getTime()
            ) / 60000;

          if (
            Number.isFinite(minutos) &&
            minutos <= 60
          ) {

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
                  planName:
                    PLANOS[plan].nome,
                  amount:
                    PLANOS[plan].valor,
                  subscriptionId:
                    pending.id,
                  checkoutId:
                    existingSession.id,
                  paymentUrl:
                    existingSession.url,
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
            SET
              status = 'EXPIRED',
              updated_at = NOW()
            WHERE id = $1
              AND status = 'PENDING'
            `,
            [pending.id]
          );
        }
      }

      const plano =
        PLANOS[plan];

      // ------------------------------------------------------
      // ASSINATURA LOCAL
      // ------------------------------------------------------

      const insertResult =
        await db.query(
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
          [
            userId,
            plan,
            plano.valor
          ]
        );

      subscriptionId =
        insertResult.rows[0].id;

      // ------------------------------------------------------
      // STRIPE CHECKOUT LIVE
      // ------------------------------------------------------

      const session =
        await stripe.checkout.sessions.create({

          mode: "subscription",

          line_items: [
            {
              price: priceId,
              quantity: 1
            }
          ],

          customer_email:
            email,

          client_reference_id:
            String(subscriptionId),

          metadata: {
            user_id:
              String(userId),

            subscription_id:
              String(subscriptionId),

            plan
          },

          subscription_data: {
            metadata: {
              user_id:
                String(userId),

              subscription_id:
                String(subscriptionId),

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

      if (
        !session.id ||
        !session.url
      ) {
        throw new Error(
          "O Stripe não retornou o ID ou URL do checkout."
        );
      }

      console.log(
        "CHECKOUT STRIPE LIVE CRIADO:",
        {
          id:
            session.id,

          status:
            session.status,

          plan,

          subscriptionId,

          priceId
        }
      );

      // ------------------------------------------------------
      // SALVAR CHECKOUT
      // ------------------------------------------------------

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
        [
          session.id,
          subscriptionId
        ]
      );

      return res.json({
        ok: true,
        provider: "STRIPE",
        plan,
        planName:
          plano.nome,
        amount:
          plano.valor,
        subscriptionId,
        checkoutId:
          session.id,
        paymentUrl:
          session.url
      });

    } catch (error) {

      console.error(
        "ERRO AO CRIAR CHECKOUT STRIPE:",
        error
      );

      if (subscriptionId) {
        try {

          await db.query(
            `
            UPDATE subscriptions
            SET
              status = 'CANCELLED',
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
  }
);


// ============================================================
// ASAAS — CHECKOUT PIX AVULSO
// ============================================================
//
// IMPORTANTE:
// O Checkout do Asaas NÃO permite PIX em operações RECURRENT.
// Para PIX, o Asaas exige chargeTypes = DETACHED.
//
// Portanto, o CriptoPro trabalha com PIX mensal avulso:
//   1. Usuário escolhe o plano.
//   2. Criamos Checkout PIX DETACHED.
//   3. CHECKOUT_PAID confirma o pagamento.
//   4. O plano é ativado por 30 dias.
//   5. Quando expirar, o usuário pode gerar um novo PIX.
//
// Em upgrade/troca, a assinatura anterior permanece ativa até
// o novo PIX ser confirmado. Só depois disso ela é encerrada.
//
// Fonte: documentação atual do Asaas.
// ============================================================

router.post(
  "/select-asaas",
  authMiddleware,
  async (req, res) => {

    let subscriptionId = null;

    try {

      if (!asaasConfigured()) {
        return res.status(500).json({
          ok: false,
          provider: "ASAAS",
          error:
            "ASAAS_API_KEY não configurada no servidor."
        });
      }

      const userId =
        getUserId(req);

      if (!userId) {
        return res.status(401).json({
          ok: false,
          error:
            "Usuário não autenticado."
        });
      }

      const plan =
        String(
          req.body?.plan || ""
        )
        .trim()
        .toLowerCase();

      const customerData =
        req.body?.customerData || {};

      if (!PLANOS[plan]) {
        return res.status(400).json({
          ok: false,
          error:
            "Plano inválido."
        });
      }

      // ------------------------------------------------------
      // USUÁRIO
      // ------------------------------------------------------

      const userResult =
        await db.query(
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
          error:
            "Usuário não encontrado."
        });
      }

      const user =
        userResult.rows[0];

      if (user.active === false) {
        return res.status(403).json({
          ok: false,
          error:
            "Usuário inativo."
        });
      }

      // ------------------------------------------------------
      // ASSINATURA ATIVA
      // ------------------------------------------------------
      //
      // Mesmo plano = bloqueia.
      // Plano diferente = permite upgrade/troca.
      //
      // A assinatura atual NÃO é cancelada agora.
      // Ela somente será encerrada quando o novo PIX for pago.
      // ------------------------------------------------------

      const activeResult =
        await db.query(
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

      const assinaturaAnterior =
        activeResult.rows.length > 0
          ? activeResult.rows[0]
          : null;

      if (
        assinaturaAnterior &&
        assinaturaAnterior.plan === plan
      ) {
        return res.status(400).json({
          ok: false,
          error:
            `Você já está no plano ${PLANOS[plan].nome}.`
        });
      }

      // ------------------------------------------------------
      // CHECKOUT PENDING RECENTE
      // ------------------------------------------------------
      //
      // Evita gerar vários PIX para a mesma troca.
      // ------------------------------------------------------

      const pendingResult =
        await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE user_id = $1
            AND status = 'PENDING'
            AND payment_provider = 'ASAAS'
            AND payment_method = 'PIX'
            AND plan = $2
          ORDER BY id DESC
          LIMIT 1
          `,
          [
            userId,
            plan
          ]
        );

      if (pendingResult.rows.length > 0) {

        const pending =
          pendingResult.rows[0];

        if (
          pending.external_payment_id &&
          String(
            pending.external_payment_id
          ).startsWith("ASAAS_CHECKOUT:") &&
          pending.created_at
        ) {

          const criadoEm =
            new Date(
              pending.created_at
            );

          const minutos =
            (
              Date.now() -
              criadoEm.getTime()
            ) / 60000;

          if (
            Number.isFinite(minutos) &&
            minutos <= 60
          ) {

            const checkoutId =
              String(
                pending.external_payment_id
              ).replace(
                "ASAAS_CHECKOUT:",
                ""
              );

            try {

              const checkout =
                await asaasRequest(
                  `/v3/checkouts/${encodeURIComponent(checkoutId)}`
                );

              const paymentUrl =
                asaasCheckoutLink(
                  checkout
                );

              if (
                paymentUrl &&
                checkout?.status !== "EXPIRED" &&
                checkout?.status !== "CANCELED" &&
                checkout?.status !== "PAID"
              ) {

                return res.json({
                  ok: true,
                  provider: "ASAAS",
                  paymentMethod: "PIX",
                  plan,
                  planName:
                    PLANOS[plan].nome,
                  amount:
                    PLANOS[plan].valor,
                  subscriptionId:
                    pending.id,
                  checkoutId,
                  paymentUrl,
                  reused: true,
                  changePlan:
                    Boolean(assinaturaAnterior),
                  previousPlan:
                    assinaturaAnterior?.plan || null
                });
              }

            } catch (error) {

              console.warn(
                "Não foi possível reutilizar Checkout Asaas pendente:",
                error.message
              );
            }
          }
        }

        await db.query(
          `
          UPDATE subscriptions
          SET
            status = 'EXPIRED',
            updated_at = NOW()
          WHERE id = $1
            AND status = 'PENDING'
          `,
          [pending.id]
        );
      }

      // ------------------------------------------------------
      // DADOS DO CLIENTE
      // ------------------------------------------------------

      const nome =
        String(
          customerData.name ||
          user.name ||
          ""
        ).trim();

      const email =
        String(
          customerData.email ||
          user.email ||
          ""
        )
        .trim()
        .toLowerCase();

      const telefone =
        somenteNumeros(
          customerData.phone ||
          customerData.telefone ||
          customerData.mobilePhone ||
          ""
        );

      if (!nome) {
        return res.status(400).json({
          ok: false,
          error:
            "Nome é obrigatório."
        });
      }

      if (!email) {
        return res.status(400).json({
          ok: false,
          error:
            "E-mail é obrigatório."
        });
      }

      const plano =
        PLANOS[plan];

      // ------------------------------------------------------
      // ASSINATURA LOCAL PENDING
      // ------------------------------------------------------

      const insertResult =
        await db.query(
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
            'PIX',
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

      // ------------------------------------------------------
      // CHECKOUT ASAAS PIX — AVULSO
      // ------------------------------------------------------
      //
      // NÃO usar RECURRENT aqui.
      // O Asaas exige:
      //   billingTypes = PIX
      //   chargeTypes  = DETACHED
      //
      // E NÃO deve existir o campo subscription.
      // ------------------------------------------------------

      const payload = {
        billingTypes: [
          "PIX"
        ],

        chargeTypes: [
          "DETACHED"
        ],

        minutesToExpire: 60,

        externalReference:
          asaasExternalReference(
            subscriptionId,
            assinaturaAnterior?.id || null
          ),

        callback: {
          successUrl:
            `${BASE_URL}/pagamento-sucesso.html?provider=asaas&subscription_id=${subscriptionId}`,

          cancelUrl:
            `${BASE_URL}/planos.html?asaas=cancelado`,

          expiredUrl:
            `${BASE_URL}/planos.html?asaas=expirado`
        },

        items: [
          {
            externalReference:
              asaasExternalReference(
                subscriptionId
              ),

            name:
              `CriptoPro — Plano ${plano.nome}`,

            description:
              `Acesso de 30 dias ao CriptoPro — Plano ${plano.nome}`,

            quantity: 1,

            value:
              Number(
                plano.valor
              )
          }
        ],

        // IMPORTANTE:
        // Não enviar customerData neste Checkout PIX.
        // O Asaas coleta CPF/CNPJ, telefone e endereço
        // diretamente no Checkout quando esses dados não são
        // informados previamente.
      };

      const checkout =
        await asaasRequest(
          "/v3/checkouts",
          {
            method: "POST",
            body: payload
          }
        );

      const checkoutId =
        checkout?.id ||
        null;

      const paymentUrl =
        asaasCheckoutLink(
          checkout
        );

      if (!checkoutId || !paymentUrl) {
        throw new Error(
          "O Asaas não retornou o ID ou link do Checkout."
        );
      }

      // ------------------------------------------------------
      // SALVA CHECKOUT
      // ------------------------------------------------------

      await db.query(
        `
        UPDATE subscriptions
        SET
          external_payment_id = $1,
          payment_provider = 'ASAAS',
          payment_method = 'PIX',
          updated_at = NOW()
        WHERE id = $2
        `,
        [
          asaasCheckoutPaymentId(
            checkoutId
          ),
          subscriptionId
        ]
      );

      console.log(
        "CHECKOUT ASAAS PIX CRIADO:",
        {
          checkoutId,
          subscriptionId,
          plan,
          amount:
            plano.valor,
          changePlan:
            Boolean(assinaturaAnterior),
          previousSubscriptionId:
            assinaturaAnterior?.id || null,
          baseUrl:
            ASAAS_BASE_URL
        }
      );

      return res.json({
        ok: true,
        provider: "ASAAS",
        paymentMethod: "PIX",
        plan,
        planName:
          plano.nome,
        amount:
          plano.valor,
        subscriptionId,
        checkoutId,
        paymentUrl,
        reused: false,
        changePlan:
          Boolean(assinaturaAnterior),
        previousPlan:
          assinaturaAnterior?.plan || null
      });

    } catch (error) {

      console.error(
        "ERRO AO CRIAR CHECKOUT ASAAS PIX:",
        error
      );

      if (subscriptionId) {
        try {
          await db.query(
            `
            UPDATE subscriptions
            SET
              status = 'CANCELLED',
              updated_at = NOW()
            WHERE id = $1
              AND status = 'PENDING'
            `,
            [subscriptionId]
          );
        } catch (dbError) {
          console.error(
            "ERRO AO CANCELAR PENDING ASAAS:",
            dbError
          );
        }
      }

      return res.status(
        error?.status || 500
      ).json({
        ok: false,
        provider: "ASAAS",
        error:
          error?.message ||
          "Erro ao criar Checkout Asaas."
      });
    }
  }
);

// ============================================================
// ALIAS — COMPATIBILIDADE COM FRONTEND
// ============================================================

router.post(
  "/select-stripe",
  authMiddleware,
  async (req, res) => {

    return res.status(307)
      .set(
        "Location",
        "/api/subscription/select"
      )
      .end();

  }
);

// ============================================================
// ALTERAR PLANO
// ============================================================
//
// FUNCIONAMENTO:
//
// 1. Localiza assinatura ACTIVE.
// 2. Tenta localizar a assinatura no Stripe LIVE.
// 3. Se existir em LIVE:
//      altera diretamente o preço.
// 4. Se o Stripe informar que o ID pertence ao TEST:
//      cria checkout NOVO em LIVE.
// 5. O plano antigo continua ativo até o pagamento LIVE.
// 6. Webhook confirma o pagamento e troca os planos.
//
// ============================================================

router.post(
  "/change-plan",
  authMiddleware,
  async (req, res) => {

    try {

      if (!stripe) {
        return res.status(500).json({
          ok: false,
          error:
            "STRIPE_SECRET_KEY não configurada no servidor."
        });
      }

      const userId =
        getUserId(req);

      if (!userId) {
        return res.status(401).json({
          ok: false,
          error:
            "Usuário não autenticado."
        });
      }

      const plan =
        String(
          req.body?.plan || ""
        )
        .trim()
        .toLowerCase();

      if (!PLANOS[plan]) {
        return res.status(400).json({
          ok: false,
          error:
            "Plano inválido."
        });
      }

      // ------------------------------------------------------
      // USUÁRIO
      // ------------------------------------------------------

      const userResult =
        await db.query(
          `
          SELECT id, name, email, active
          FROM users
          WHERE id = $1
          LIMIT 1
          `,
          [userId]
        );

      if (
        userResult.rows.length === 0
      ) {
        return res.status(404).json({
          ok: false,
          error:
            "Usuário não encontrado."
        });
      }

      const user =
        userResult.rows[0];

      if (user.active === false) {
        return res.status(403).json({
          ok: false,
          error:
            "Usuário inativo."
        });
      }

      const email =
        String(
          user.email || ""
        )
        .trim()
        .toLowerCase();

      const nome =
        String(
          user.name || ""
        ).trim();

      if (!email) {
        return res.status(400).json({
          ok: false,
          error:
            "Usuário não possui e-mail cadastrado."
        });
      }

      // ------------------------------------------------------
      // ASSINATURA ATIVA
      // ------------------------------------------------------

      const activeResult =
        await db.query(
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

      if (
        activeResult.rows.length === 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Você não possui uma assinatura ativa para alterar."
        });
      }

      const assinatura =
        activeResult.rows[0];

      const planoAtual =
        PLANOS[assinatura.plan] ||
        null;

      const novoPlano =
        PLANOS[plan];

      // ------------------------------------------------------
      // MESMO PLANO
      // ------------------------------------------------------

      if (
        assinatura.plan === plan
      ) {
        return res.status(400).json({
          ok: false,
          error:
            `Você já está no plano ${novoPlano.nome}.`
        });
      }

      // ------------------------------------------------------
      // PRICE ID
      // ------------------------------------------------------

      const priceId =
        stripePriceId(plan);

      if (!priceId) {
        return res.status(500).json({
          ok: false,
          error:
            `Price ID do plano ${novoPlano.nome} não configurado no servidor.`
        });
      }

      // ------------------------------------------------------
      // SEM ID STRIPE
      // ------------------------------------------------------
      //
      // Se não temos o ID da assinatura, não conseguimos
      // atualizar diretamente. Criamos um novo checkout LIVE.
      //

      if (
        !assinatura.external_subscription_id
      ) {

        const checkout =
          await criarCheckoutLiveParaTroca({
            userId,
            assinaturaAntiga:
              assinatura,
            planoNovo:
              plan,
            email,
            nome
          });

        return res.json({
          ok: true,
          changed: false,
          requiresCheckout: true,

          plan,
          planName:
            novoPlano.nome,

          amount:
            novoPlano.valor,

          previousPlan:
            assinatura.plan,

          previousPlanName:
            planoAtual?.nome ||
            assinatura.plan,

          subscriptionId:
            checkout.subscriptionId,

          checkoutId:
            checkout.checkoutId,

          paymentUrl:
            checkout.paymentUrl,

          reused:
            checkout.reused,

          message:
            `Para alterar de ${planoAtual?.nome || assinatura.plan} para ${novoPlano.nome}, finalize o pagamento no Stripe.`
        });
      }

      // ------------------------------------------------------
      // TENTA RECUPERAR ASSINATURA NO STRIPE LIVE
      // ------------------------------------------------------

      let stripeSubscription;

      try {

        stripeSubscription =
          await stripe.subscriptions.retrieve(
            assinatura.external_subscription_id
          );

      } catch (error) {

        // ----------------------------------------------------
        // CASO ESPECIAL:
        // ID É DE TESTE, MAS CHAVE ATUAL É LIVE
        // ----------------------------------------------------

        if (
          assinaturaStripeDeOutroModo(error)
        ) {

          console.warn(
            "ASSINATURA STRIPE DE OUTRO MODO DETECTADA.",
            {
              localSubscriptionId:
                assinatura.id,

              externalSubscriptionId:
                assinatura.external_subscription_id,

              currentPlan:
                assinatura.plan,

              requestedPlan:
                plan,

              stripeMode:
                String(
                  STRIPE_SECRET_KEY || ""
                ).startsWith(
                  "sk_live_"
                )
                  ? "LIVE"
                  : "TEST"
            }
          );

          const checkout =
            await criarCheckoutLiveParaTroca({
              userId,
              assinaturaAntiga:
                assinatura,
              planoNovo:
                plan,
              email,
              nome
            });

          return res.json({
            ok: true,

            changed: false,

            requiresCheckout: true,

            migrationFromOtherMode:
              true,

            plan,

            planName:
              novoPlano.nome,

            amount:
              novoPlano.valor,

            previousPlan:
              assinatura.plan,

            previousPlanName:
              planoAtual?.nome ||
              assinatura.plan,

            subscriptionId:
              checkout.subscriptionId,

            checkoutId:
              checkout.checkoutId,

            paymentUrl:
              checkout.paymentUrl,

            reused:
              checkout.reused,

            message:
              `Sua assinatura atual foi criada em outro ambiente do Stripe. Para migrar para o ambiente LIVE, finalize o novo pagamento do plano ${novoPlano.nome}.`
          });

        }

        throw error;
      }

      // ------------------------------------------------------
      // ASSINATURA LIVE ENCONTRADA
      // ------------------------------------------------------

      const item =
        stripeSubscription
          ?.items
          ?.data
          ?.[0];

      if (!item) {
        return res.status(409).json({
          ok: false,
          error:
            "Não foi possível localizar o item da assinatura no Stripe."
        });
      }

      // ------------------------------------------------------
      // ALTERAÇÃO DIRETA NO STRIPE LIVE
      // ------------------------------------------------------
      //
      // always_invoice:
      // cobra imediatamente a diferença proporcional quando
      // houver valor a cobrar.
      //
      // error_if_incomplete:
      // se o pagamento da alteração exigir ação ou falhar,
      // o Stripe não aplica a alteração.
      //
      // ------------------------------------------------------

      const updatedSubscription =
        await stripe.subscriptions.update(
          stripeSubscription.id,
          {
            items: [
              {
                id:
                  item.id,

                price:
                  priceId,

                quantity:
                  1
              }
            ],

            proration_behavior:
              "always_invoice",

            payment_behavior:
              "error_if_incomplete",

            metadata: {
              ...(stripeSubscription.metadata || {}),

              user_id:
                String(userId),

              subscription_id:
                String(assinatura.id),

              plan:
                String(plan)
            }
          }
        );

      // ------------------------------------------------------
      // ATUALIZA BANCO
      // ------------------------------------------------------

      await db.query(
        `
        UPDATE subscriptions
        SET
          plan = $1,
          amount = $2,
          external_subscription_id = $3,
          payment_provider = 'STRIPE',
          updated_at = NOW()
        WHERE id = $4
        `,
        [
          plan,

          novoPlano.valor,

          updatedSubscription.id,

          assinatura.id
        ]
      );

      console.log(
        "PLANO ALTERADO DIRETAMENTE NO STRIPE LIVE:",
        {
          localSubscriptionId:
            assinatura.id,

          stripeSubscriptionId:
            updatedSubscription.id,

          previousPlan:
            assinatura.plan,

          newPlan:
            plan
        }
      );

      return res.json({
        ok: true,

        changed: true,

        requiresCheckout: false,

        plan,

        planName:
          novoPlano.nome,

        amount:
          novoPlano.valor,

        previousPlan:
          assinatura.plan,

        previousPlanName:
          planoAtual?.nome ||
          assinatura.plan,

        subscriptionId:
          assinatura.id,

        stripeSubscriptionId:
          updatedSubscription.id,

        message:
          `Plano alterado de ${planoAtual?.nome || assinatura.plan} para ${novoPlano.nome} com sucesso.`
      });

    } catch (error) {

      console.error(
        "ERRO AO ALTERAR PLANO STRIPE:",
        error
      );

      const status =
        error?.statusCode ||
        error?.status ||
        500;

      return res.status(status).json({
        ok: false,
        error:
          error?.message ||
          "Não foi possível alterar o plano."
      });
    }
  }
);

// ============================================================
// STATUS DA ASSINATURA
// ============================================================

router.get(
  "/status",
  authMiddleware,
  async (req, res) => {

    try {

      const userId =
        getUserId(req);

      if (!userId) {
        return res.status(401).json({
          ok: false,
          error:
            "Usuário não autenticado."
        });
      }

      // ------------------------------------------------------
      // PROCURA ACTIVE VÁLIDA
      // ------------------------------------------------------

      let result =
        await db.query(
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

      // ------------------------------------------------------
      // SE NÃO EXISTIR ACTIVE VÁLIDA,
      // PEGA O REGISTRO MAIS RECENTE
      // ------------------------------------------------------

      if (
        result.rows.length === 0
      ) {

        result =
          await db.query(
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

      if (
        result.rows.length === 0
      ) {

        return res.json({
          ok: true,

          active: false,

          status: "NONE",

          plan: null,

          planName: null,

          amount: 0,

          operacoesSimultaneas:
            0,

          contasBinance:
            0,

          robos:
            0,

          started_at:
            null,

          expires_at:
            null,

          expiresAt:
            null,

          subscriptionId:
            null,

          paymentProvider:
            null
        });
      }

      const assinatura =
        result.rows[0];

      // ------------------------------------------------------
      // PROTEÇÃO CONTRA ACTIVE EXPIRADA
      // ------------------------------------------------------

      if (
        assinatura.status === "ACTIVE" &&
        assinatura.expires_at
      ) {

        const expiracao =
          new Date(
            assinatura.expires_at
          );

        if (
          !Number.isNaN(
            expiracao.getTime()
          ) &&
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

          assinatura.status =
            "EXPIRED";
        }
      }

      const plano =
        PLANOS[
          assinatura.plan
        ] || null;

      const active =
        assinatura.status === "ACTIVE" &&
        (
          !assinatura.expires_at ||
          new Date(
            assinatura.expires_at
          ) > new Date()
        );

      return res.json({
        ok: true,

        active,

        status:
          active
            ? "ACTIVE"
            : assinatura.status,

        plan:
          assinatura.plan ||
          null,

        planName:
          plano?.nome ||
          assinatura.plan ||
          null,

        amount:
          Number(
            assinatura.amount || 0
          ),

        operacoesSimultaneas:
          plano?.operacoesSimultaneas ||
          0,

        contasBinance:
          plano?.contasBinance ||
          0,

        robos:
          plano?.robos ||
          0,

        started_at:
          assinatura.started_at ||
          null,

        expires_at:
          assinatura.expires_at ||
          null,

        expiresAt:
          assinatura.expires_at ||
          null,

        subscriptionId:
          assinatura.id,

        paymentProvider:
          assinatura.payment_provider ||
          "STRIPE"
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
  }
);

// ============================================================
// WEBHOOK STRIPE
// ============================================================
//
// IMPORTANTE:
//
// Esta rota precisa receber o corpo RAW.
//
// O server.js precisa registrar o webhook com:
//
// app.post(
//   "/api/subscription/webhook/stripe",
//   express.raw({ type: "application/json" }),
//   subscriptionRouter
// )
//
// antes do express.json().
//
// ============================================================

async function processarWebhookStripe(
  req,
  res
) {

  if (!stripe) {
    return res.status(500).json({
      ok: false,
      error:
        "STRIPE_SECRET_KEY não configurada."
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
      error:
        "Webhook Stripe não configurado no servidor."
    });
  }

  const signature =
    getStripeSignature(req);

  if (!signature) {
    return res.status(400).json({
      ok: false,
      error:
        "Assinatura Stripe ausente."
    });
  }

  let event;

  try {

    event =
      stripe.webhooks.constructEvent(
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
      error:
        "Assinatura do webhook inválida."
    });
  }

  console.log(
    "WEBHOOK STRIPE:",
    event.type,
    event.id
  );

  try {

    const object =
      event.data?.object || {};

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

    // ========================================================
    // CHECKOUT.SESSION.COMPLETED
    // ========================================================

    if (
      event.type ===
      "checkout.session.completed"
    ) {

      if (
        !subscriptionId &&
        object.client_reference_id
      ) {

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

      const localResult =
        await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE id = $1
          LIMIT 1
          `,
          [subscriptionId]
        );

      if (
        localResult.rows.length === 0
      ) {

        console.warn(
          "Webhook Stripe: assinatura local não encontrada:",
          subscriptionId
        );

        return res.json({
          ok: true,
          ignored: true
        });
      }

      const assinatura =
        localResult.rows[0];

      const stripeSubscriptionId =
        typeof object.subscription === "string"
          ? object.subscription
          : object.subscription?.id ||
            null;

      await db.query(
        `
        UPDATE subscriptions
        SET
          external_payment_id =
            COALESCE($1, external_payment_id),

          external_subscription_id =
            COALESCE($2, external_subscription_id),

          updated_at =
            NOW()
        WHERE id = $3
        `,
        [
          object.id ||
            null,

          stripeSubscriptionId,

          assinatura.id
        ]
      );

      console.log(
        `Checkout Stripe concluído para assinatura local ${assinatura.id}`
      );
    }

    // ========================================================
    // INVOICE.PAID
    // ========================================================

    else if (
      event.type ===
      "invoice.paid"
    ) {

      let localResult =
        null;

      const invoiceSubscriptionDetails =
        object.parent
          ?.subscription_details ||
        {};

      const invoiceMetadata =
        invoiceSubscriptionDetails.metadata ||
        {};

      const firstLine =
        Array.isArray(
          object.lines?.data
        ) &&
        object.lines.data.length > 0
          ? object.lines.data[0]
          : null;

      const lineMetadata =
        firstLine?.metadata ||
        {};

      const lineSubscriptionDetails =
        firstLine
          ?.parent
          ?.subscription_item_details ||
        {};

      // ------------------------------------------------------
      // LOCAL SUBSCRIPTION
      // ------------------------------------------------------

      subscriptionId =
        subscriptionId ||
        invoiceMetadata.subscription_id ||
        lineMetadata.subscription_id ||
        object.client_reference_id ||
        null;

      // ------------------------------------------------------
      // STRIPE SUBSCRIPTION
      // ------------------------------------------------------

      const stripeSubscriptionId =
        typeof object.subscription === "string"
          ? object.subscription
          : object.subscription?.id ||
            invoiceSubscriptionDetails.subscription ||
            lineSubscriptionDetails.subscription ||
            null;

      // ------------------------------------------------------
      // TENTA PELO ID LOCAL
      // ------------------------------------------------------

      if (subscriptionId) {

        localResult =
          await db.query(
            `
            SELECT *
            FROM subscriptions
            WHERE id = $1
            LIMIT 1
            `,
            [subscriptionId]
          );
      }

      // ------------------------------------------------------
      // TENTA PELO STRIPE SUBSCRIPTION ID
      // ------------------------------------------------------

      if (
        (!localResult ||
          localResult.rows.length === 0) &&
        stripeSubscriptionId
      ) {

        localResult =
          await db.query(
            `
            SELECT *
            FROM subscriptions
            WHERE external_subscription_id = $1
            LIMIT 1
            `,
            [stripeSubscriptionId]
          );
      }

      if (
        !localResult ||
        localResult.rows.length === 0
      ) {

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

      const assinatura =
        localResult.rows[0];

      // ------------------------------------------------------
      // METADATA DA MIGRAÇÃO TEST -> LIVE
      // ------------------------------------------------------

      const previousSubscriptionId =
        metadata.previous_subscription_id ||
        invoiceMetadata.previous_subscription_id ||
        lineMetadata.previous_subscription_id ||
        null;

      // ------------------------------------------------------
      // ATIVA NOVA ASSINATURA
      // ------------------------------------------------------

      const agora =
        new Date();

      const expiresAt =
        adicionarUmMes(
          agora
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

          updated_at =
            NOW()

        WHERE id = $3
        `,
        [
          expiresAt.toISOString(),

          stripeSubscriptionId,

          assinatura.id
        ]
      );

      // ------------------------------------------------------
      // SE FOI MIGRAÇÃO/UPGRADE,
      // DESATIVA A ASSINATURA LOCAL ANTIGA
      // ------------------------------------------------------

      if (
        previousSubscriptionId &&
        String(
          previousSubscriptionId
        ) !== String(
          assinatura.id
        )
      ) {

        await db.query(
          `
          UPDATE subscriptions
          SET
            status = 'CANCELLED',
            updated_at = NOW()
          WHERE id = $1
            AND status = 'ACTIVE'
          `,
          [
            previousSubscriptionId
          ]
        );

        console.log(
          "ASSINATURA LOCAL ANTIGA CANCELADA APÓS PAGAMENTO LIVE:",
          {
            previousSubscriptionId,

            newSubscriptionId:
              assinatura.id
          }
        );
      }

      console.log(
        `Assinatura ${assinatura.id} ATIVADA via Stripe invoice.paid`
      );
    }

    // ========================================================
    // INVOICE.PAYMENT_FAILED
    // ========================================================

    else if (
      event.type ===
      "invoice.payment_failed"
    ) {

      let localResult =
        null;

      const invoiceSubscriptionDetails =
        object.parent
          ?.subscription_details ||
        {};

      const invoiceMetadata =
        invoiceSubscriptionDetails.metadata ||
        {};

      const firstLine =
        Array.isArray(
          object.lines?.data
        ) &&
        object.lines.data.length > 0
          ? object.lines.data[0]
          : null;

      const lineMetadata =
        firstLine?.metadata ||
        {};

      const lineSubscriptionDetails =
        firstLine
          ?.parent
          ?.subscription_item_details ||
        {};

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

        localResult =
          await db.query(
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
        (!localResult ||
          localResult.rows.length === 0) &&
        stripeSubscriptionId
      ) {

        localResult =
          await db.query(
            `
            SELECT *
            FROM subscriptions
            WHERE external_subscription_id = $1
            LIMIT 1
            `,
            [stripeSubscriptionId]
          );
      }

      if (
        localResult &&
        localResult.rows.length > 0
      ) {

        const assinatura =
          localResult.rows[0];

        // ----------------------------------------------------
        // IMPORTANTE:
        //
        // Se for uma troca TEST -> LIVE e o novo pagamento
        // falhar, NÃO mexemos na assinatura antiga.
        //
        // A nova permanece PENDING.
        // ----------------------------------------------------

        if (
          assinatura.status ===
          "PENDING"
        ) {

          console.log(
            `Pagamento Stripe falhou para assinatura PENDING ${assinatura.id}`
          );

        } else {

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
    }

    // ========================================================
    // CUSTOMER.SUBSCRIPTION.DELETED
    // ========================================================

    else if (
      event.type ===
      "customer.subscription.deleted"
    ) {

      const stripeSubscriptionId =
        object.id ||
        null;

      let localResult =
        null;

      if (subscriptionId) {

        localResult =
          await db.query(
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
        (!localResult ||
          localResult.rows.length === 0) &&
        stripeSubscriptionId
      ) {

        localResult =
          await db.query(
            `
            SELECT *
            FROM subscriptions
            WHERE external_subscription_id = $1
            LIMIT 1
            `,
            [stripeSubscriptionId]
          );
      }

      if (
        localResult &&
        localResult.rows.length > 0
      ) {

        const assinatura =
          localResult.rows[0];

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

    // ========================================================
    // CUSTOMER.SUBSCRIPTION.UPDATED
    // ========================================================

    else if (
      event.type ===
      "customer.subscription.updated"
    ) {

      const stripeSubscriptionId =
        object.id ||
        null;

      let localResult =
        null;

      if (subscriptionId) {

        localResult =
          await db.query(
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
        (!localResult ||
          localResult.rows.length === 0) &&
        stripeSubscriptionId
      ) {

        localResult =
          await db.query(
            `
            SELECT *
            FROM subscriptions
            WHERE external_subscription_id = $1
            LIMIT 1
            `,
            [stripeSubscriptionId]
          );
      }

      if (
        localResult &&
        localResult.rows.length > 0
      ) {

        const assinatura =
          localResult.rows[0];

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
                COALESCE(
                  $1,
                  external_subscription_id
                ),

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
      event:
        event.type
    });

  } catch (error) {

    console.error(
      "ERRO AO PROCESSAR WEBHOOK STRIPE:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "Erro interno ao processar webhook Stripe."
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
// WEBHOOK ASAAS
// ============================================================
//
// Eventos utilizados:
//   CHECKOUT_PAID
//   CHECKOUT_CANCELED
//   CHECKOUT_EXPIRED
//   SUBSCRIPTION_CREATED
//   SUBSCRIPTION_UPDATED
//   SUBSCRIPTION_INACTIVATED
//   SUBSCRIPTION_DELETED
//   PAYMENT_RECEIVED
//   PAYMENT_OVERDUE
//   PAYMENT_REFUNDED
//
// Segurança:
//   header "asaas-access-token"
//   valor = ASAAS_WEBHOOK_TOKEN
//
// O Asaas entrega Webhooks em modelo at-least-once.
// O código abaixo evita efeitos duplicados usando os próprios
// identificadores de Checkout/Pagamento e estados da assinatura.
//
// ============================================================

async function processarWebhookAsaas(req, res) {

  if (!ASAAS_WEBHOOK_TOKEN) {
    console.error(
      "ASAAS_WEBHOOK_TOKEN não configurado."
    );

    return res.status(500).json({
      ok: false,
      error:
        "Webhook Asaas não configurado no servidor."
    });
  }

  const receivedToken =
    String(
      req.headers["asaas-access-token"] ||
      ""
    );

  if (
    !receivedToken ||
    receivedToken !== String(ASAAS_WEBHOOK_TOKEN)
  ) {
    console.warn(
      "WEBHOOK ASAAS: token inválido."
    );

    return res.status(401).json({
      ok: false,
      error:
        "Token do webhook Asaas inválido."
    });
  }

  const event =
    req.body || {};

  const eventId =
    event.id || null;

  const eventType =
    String(event.event || "");

  if (!eventId || !eventType) {
    return res.status(400).json({
      ok: false,
      error:
        "Payload de webhook Asaas inválido."
    });
  }

  console.log(
    "WEBHOOK ASAAS:",
    eventType,
    eventId
  );

  try {

    // ========================================================
    // CHECKOUT PAID
    // ========================================================
    //
    // Para PIX DETACHED, este é o evento principal de
    // confirmação do pagamento do Checkout.
    // ========================================================

    if (eventType === "CHECKOUT_PAID") {

      const checkout =
        event.checkout || {};

      const localId =
        subscriptionIdFromAsaasReference(
          checkout.externalReference
        );

      const previousLocalId =
        previousSubscriptionIdFromAsaasReference(
          checkout.externalReference
        );

      if (!localId) {
        console.warn(
          "Webhook Asaas CHECKOUT_PAID sem externalReference CriptoPro.",
          {
            checkoutId:
              checkout.id || null
          }
        );

        return res.json({
          ok: true,
          ignored: true
        });
      }

      const result =
        await db.query(
          `
          SELECT *
          FROM subscriptions
          WHERE id = $1
            AND payment_provider = 'ASAAS'
          LIMIT 1
          `,
          [localId]
        );

      if (result.rows.length === 0) {
        console.warn(
          "Webhook Asaas: assinatura local não encontrada:",
          localId
        );

        return res.json({
          ok: true,
          ignored: true
        });
      }

      const assinatura =
        result.rows[0];

      const checkoutPaymentId =
        asaasCheckoutPaymentId(
          checkout.id
        );

      // ------------------------------------------------------
      // IDEMPOTÊNCIA
      // ------------------------------------------------------
      // Se o mesmo Checkout já ativou o plano, não adicionamos
      // mais 30 dias novamente.
      // ------------------------------------------------------

      if (
        assinatura.status === "ACTIVE" &&
        String(
          assinatura.external_payment_id || ""
        ) === checkoutPaymentId
      ) {
        return res.json({
          ok: true,
          received: true,
          duplicate: true,
          event: eventType
        });
      }

      // Se já estiver ACTIVE por outro motivo, não devemos
      // transformar o mesmo evento em uma segunda renovação.
      if (
        assinatura.status === "ACTIVE" &&
        String(
          assinatura.external_payment_id || ""
        ) !== checkoutPaymentId
      ) {
        console.warn(
          "CHECKOUT_PAID ASAAS recebido para assinatura já ACTIVE; ignorando para evitar duplicidade.",
          {
            subscriptionId:
              assinatura.id,
            checkoutId:
              checkout.id
          }
        );

        return res.json({
          ok: true,
          received: true,
          ignored: true,
          reason:
            "Assinatura já estava ACTIVE."
        });
      }

      const agora =
        new Date();

      const expiresAt =
        adicionarUmMes(agora);

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
          external_payment_id = $2,
          external_subscription_id = NULL,
          updated_at = NOW()
        WHERE id = $3
          AND status = 'PENDING'
        `,
        [
          expiresAt.toISOString(),
          checkoutPaymentId,
          assinatura.id
        ]
      );

      // ------------------------------------------------------
      // UPGRADE / TROCA DE PLANO
      // ------------------------------------------------------
      //
      // Só agora, depois do PIX confirmado, encerramos o plano
      // anterior.
      // ------------------------------------------------------

      if (
        previousLocalId &&
        String(previousLocalId) !==
          String(assinatura.id)
      ) {

        const previousResult =
          await db.query(
            `
            SELECT *
            FROM subscriptions
            WHERE id = $1
            LIMIT 1
            `,
            [previousLocalId]
          );

        if (previousResult.rows.length > 0) {

          const assinaturaAnterior =
            previousResult.rows[0];

          // Primeiro tenta encerrar a cobrança externa quando
          // houver uma assinatura real cancelável.
          await cancelarAssinaturaAnterior(
            assinaturaAnterior
          );

          await db.query(
            `
            UPDATE subscriptions
            SET
              status = 'CANCELLED',
              updated_at = NOW()
            WHERE id = $1
              AND status = 'ACTIVE'
            `,
            [assinaturaAnterior.id]
          );

          console.log(
            "PLANO ANTERIOR CANCELADO APÓS PAGAMENTO ASAAS:",
            {
              previousSubscriptionId:
                assinaturaAnterior.id,
              previousPlan:
                assinaturaAnterior.plan,
              newSubscriptionId:
                assinatura.id,
              newPlan:
                assinatura.plan
            }
          );
        }
      }

      console.log(
        "PIX ASAAS CONFIRMADO VIA CHECKOUT_PAID:",
        {
          subscriptionId:
            assinatura.id,
          checkoutId:
            checkout.id,
          plan:
            assinatura.plan,
          expiresAt:
            expiresAt.toISOString()
        }
      );
    }

    // ========================================================
    // CHECKOUT CANCELED
    // ========================================================

    else if (eventType === "CHECKOUT_CANCELED") {

      const checkout =
        event.checkout || {};

      const localId =
        subscriptionIdFromAsaasReference(
          checkout.externalReference
        );

      if (localId) {
        await db.query(
          `
          UPDATE subscriptions
          SET
            status = 'CANCELLED',
            updated_at = NOW()
          WHERE id = $1
            AND payment_provider = 'ASAAS'
            AND status = 'PENDING'
          `,
          [localId]
        );
      }
    }

    // ========================================================
    // CHECKOUT EXPIRED
    // ========================================================

    else if (eventType === "CHECKOUT_EXPIRED") {

      const checkout =
        event.checkout || {};

      const localId =
        subscriptionIdFromAsaasReference(
          checkout.externalReference
        );

      if (localId) {
        await db.query(
          `
          UPDATE subscriptions
          SET
            status = 'EXPIRED',
            updated_at = NOW()
          WHERE id = $1
            AND payment_provider = 'ASAAS'
            AND status = 'PENDING'
          `,
          [localId]
        );
      }
    }

    // ========================================================
    // CHECKOUT CREATED
    // ========================================================

    else if (eventType === "CHECKOUT_CREATED") {

      const checkout =
        event.checkout || {};

      const localId =
        subscriptionIdFromAsaasReference(
          checkout.externalReference
        );

      if (localId && checkout.id) {
        await db.query(
          `
          UPDATE subscriptions
          SET
            external_payment_id = $1,
            updated_at = NOW()
          WHERE id = $2
            AND payment_provider = 'ASAAS'
          `,
          [
            asaasCheckoutPaymentId(
              checkout.id
            ),
            localId
          ]
        );
      }
    }

    // ========================================================
    // PAYMENT_RECEIVED
    // ========================================================
    //
    // Checkout PIX DETACHED não cria uma assinatura recorrente.
    // Portanto não usamos PAYMENT_RECEIVED para somar meses.
    // O primeiro e único pagamento daquele Checkout é confirmado
    // pelo CHECKOUT_PAID.
    //
    // Mantemos o evento tratado para não retornar erro ao Asaas.
    // ========================================================

    else if (eventType === "PAYMENT_RECEIVED") {

      const payment =
        event.payment || {};

      console.log(
        "PAYMENT_RECEIVED ASAAS recebido; PIX do CriptoPro é DETACHED e já é conciliado pelo CHECKOUT_PAID.",
        {
          paymentId:
            payment.id || null,
          subscription:
            payment.subscription || null
        }
      );
    }

    return res.json({
      ok: true,
      received: true,
      event: eventType
    });

  } catch (error) {

    console.error(
      "ERRO AO PROCESSAR WEBHOOK ASAAS:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "Erro interno ao processar webhook Asaas."
    });
  }
}

// ============================================================
// ROTA WEBHOOK ASAAS
// ============================================================

router.post(
  "/webhook/asaas",
  processarWebhookAsaas
);

// ============================================================
// COMPATIBILIDADE
// ============================================================

router.get(
  "/teste-mercadopago",
  (req, res) => {

    return res.json({
      ok: true,

      message:
        "Mercado Pago não é utilizado. Stripe e Asaas estão disponíveis.",

      providers: [
        "STRIPE",
        "ASAAS"
      ]
    });
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
