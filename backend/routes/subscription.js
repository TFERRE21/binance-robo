const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

const ASAAS_API_URL =
  process.env.ASAAS_API_URL || "https://api.asaas.com/v3";

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN;

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
// REQUISIÇÃO ASAAS
// ============================================================

async function asaasRequest(endpoint, options = {}) {
  if (!ASAAS_API_KEY) {
    throw new Error("ASAAS_API_KEY não configurada.");
  }

  const response = await fetch(`${ASAAS_API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "access_token": ASAAS_API_KEY,
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    console.error("Erro Asaas:", {
      status: response.status,
      endpoint,
      data
    });

    throw new Error(
      data?.errors?.[0]?.description ||
      data?.message ||
      `Erro Asaas HTTP ${response.status}`
    );
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

// ============================================================
// GERAR LINK DO CHECKOUT
// ============================================================

function gerarLinkCheckout(checkoutId) {
  return `https://asaas.com/checkoutSession/show?id=${checkoutId}`;
}

// ============================================================
// TESTE
// ============================================================

router.get("/teste", (req, res) => {
  res.json({
    ok: true,
    service: "subscription",
    provider: "ASAAS"
  });
});

// ============================================================
// TESTE MERCADO PAGO
// Mantido para não quebrar código antigo
// ============================================================

router.get("/teste-mercadopago", (req, res) => {
  res.json({
    ok: true,
    message: "Rota antiga mantida apenas para compatibilidade.",
    provider: "MERCADO_PAGO"
  });
});

// ============================================================
// LISTAR PLANOS
// ============================================================

router.get("/plans", (req, res) => {
  res.json({
    ok: true,
    planos: PLANOS
  });
});

// ============================================================
// SELECIONAR PLANO
// ============================================================

router.post("/select", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Usuário não autenticado."
      });
    }

    const {
      plan,
      customerData
    } = req.body;

    // --------------------------------------------------------
    // VALIDAR PLANO
    // --------------------------------------------------------

    if (!plan || !PLANOS[plan]) {
      return res.status(400).json({
        ok: false,
        error: "Plano inválido."
      });
    }

    // --------------------------------------------------------
    // VALIDAR DADOS DO CLIENTE
    // --------------------------------------------------------

    if (!customerData) {
      return res.status(400).json({
        ok: false,
        error: "Dados do cliente são obrigatórios."
      });
    }

    const nome = String(customerData.name || "").trim();
    const email = String(customerData.email || "").trim();
    const cpfCnpj = somenteNumeros(
      customerData.cpfCnpj ||
      customerData.cpf ||
      customerData.cnpj
    );

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
    // VERIFICAR ASSINATURA ATIVA
    // --------------------------------------------------------

    const assinaturaAtiva = await new Promise((resolve, reject) => {
      db.get(
        `
        SELECT *
        FROM subscriptions
        WHERE user_id = ?
          AND status = 'ACTIVE'
        ORDER BY id DESC
        LIMIT 1
        `,
        [userId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });

    if (assinaturaAtiva) {
      return res.status(400).json({
        ok: false,
        error: "Você já possui uma assinatura ativa."
      });
    }

    // --------------------------------------------------------
    // VERIFICAR CHECKOUT PENDENTE
    // --------------------------------------------------------

    const pendente = await new Promise((resolve, reject) => {
      db.get(
        `
        SELECT *
        FROM subscriptions
        WHERE user_id = ?
          AND status = 'PENDING'
          AND payment_provider = 'ASAAS'
        ORDER BY id DESC
        LIMIT 1
        `,
        [userId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });

    // --------------------------------------------------------
    // REUTILIZAR CHECKOUT SOMENTE SE AINDA ESTIVER VÁLIDO
    // --------------------------------------------------------

    if (
      pendente &&
      pendente.external_payment_id &&
      pendente.created_at
    ) {
      const criadoEm = new Date(pendente.created_at);
      const agora = new Date();

      const minutos =
        (agora.getTime() - criadoEm.getTime()) / 60000;

      if (minutos <= 60) {
        return res.json({
          ok: true,
          paymentUrl: gerarLinkCheckout(
            pendente.external_payment_id
          ),
          checkoutId: pendente.external_payment_id,
          subscriptionId: pendente.id,
          reused: true
        });
      }

      // Checkout antigo
      await new Promise((resolve, reject) => {
        db.run(
          `
          UPDATE subscriptions
          SET status = 'EXPIRED',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
          [pendente.id],
          err => {
            if (err) return reject(err);
            resolve();
          }
        );
      });
    }

    // --------------------------------------------------------
    // DADOS DO PLANO
    // --------------------------------------------------------

    const plano = PLANOS[plan];

    // --------------------------------------------------------
    // CRIAR ASSINATURA LOCAL
    // --------------------------------------------------------

    const subscriptionId = await new Promise((resolve, reject) => {
      db.run(
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
        VALUES (?, ?, 'PENDING', ?, 'ASAAS', 'CREDIT_CARD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [
          userId,
          plan,
          plano.valor
        ],
        function (err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
    });

    // ========================================================
    // CRIAR CHECKOUT ASAAS
    // ========================================================

    const checkoutPayload = {
      billingTypes: [
        "CREDIT_CARD"
      ],

      chargeTypes: [
        "RECURRENT"
      ],

      minutesToExpire: 60,

      externalReference: String(subscriptionId),

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
          name: `CriptoPro ${plano.nome}`,
          description:
            `Assinatura mensal CriptoPro ${plano.nome}`,
          quantity: 1,
          value: plano.valor
        }
      ],

      customerData: {
        name: nome,
        email: email,
        cpfCnpj: cpfCnpj,
        phone: telefone
      },

      subscription: {
        cycle: "MONTHLY",
        nextDueDate: dataAsaas()
      }
    };

    console.log("CRIANDO CHECKOUT ASAAS:", {
      plan,
      subscriptionId,
      customerData: {
        name: nome,
        email: email,
        cpfCnpj: cpfCnpj,
        phone: telefone
      }
    });

    const checkout = await asaasRequest(
      "/checkouts",
      {
        method: "POST",
        body: JSON.stringify(checkoutPayload)
      }
    );

    console.log("CHECKOUT ASAAS CRIADO:", {
      id: checkout.id,
      status: checkout.status
    });

    // ========================================================
    // SALVAR CHECKOUT ASAAS
    // ========================================================

    await new Promise((resolve, reject) => {
      db.run(
        `
        UPDATE subscriptions
        SET external_payment_id = ?,
            payment_provider = 'ASAAS',
            payment_method = 'CREDIT_CARD',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [
          checkout.id,
          subscriptionId
        ],
        err => {
          if (err) return reject(err);
          resolve();
        }
      );
    });

    // ========================================================
    // RESPONDER PARA FRONTEND
    // ========================================================

    return res.json({
      ok: true,

      plan,

      planName: plano.nome,

      amount: plano.valor,

      subscriptionId,

      checkoutId: checkout.id,

      paymentUrl: gerarLinkCheckout(
        checkout.id
      )
    });

  } catch (error) {
    console.error(
      "Erro ao selecionar plano:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error.message ||
        "Erro ao criar checkout."
    });
  }
});

// ============================================================
// STATUS DA ASSINATURA
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

    const assinatura = await new Promise(
      (resolve, reject) => {
        db.get(
          `
          SELECT *
          FROM subscriptions
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT 1
          `,
          [userId],
          (err, row) => {
            if (err) return reject(err);
            resolve(row);
          }
        );
      }
    );

    if (!assinatura) {
      return res.json({
        ok: true,
        active: false,
        status: "NONE"
      });
    }

    // --------------------------------------------------------
    // VERIFICAR EXPIRAÇÃO
    // --------------------------------------------------------

    if (
      assinatura.status === "ACTIVE" &&
      assinatura.expires_at
    ) {
      const agora = new Date();
      const expiracao =
        new Date(assinatura.expires_at);

      if (expiracao <= agora) {
        await new Promise(
          (resolve, reject) => {
            db.run(
              `
              UPDATE subscriptions
              SET status = 'EXPIRED',
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
              `,
              [assinatura.id],
              err => {
                if (err) return reject(err);
                resolve();
              }
            );
          }
        );

        assinatura.status = "EXPIRED";
      }
    }

    const plano =
      PLANOS[assinatura.plan];

    return res.json({
      ok: true,

      active:
        assinatura.status === "ACTIVE",

      status:
        assinatura.status,

      plan:
        assinatura.plan,

      planName:
        plano?.nome || assinatura.plan,

      amount:
        assinatura.amount,

      operacoesSimultaneas:
        plano?.operacoesSimultaneas || 0,

      contasBinance:
        plano?.contasBinance || 0,

      started_at:
        assinatura.started_at,

      expires_at:
        assinatura.expires_at,

      subscriptionId:
        assinatura.id
    });

  } catch (error) {
    console.error(
      "Erro ao consultar assinatura:",
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

async function encontrarAssinaturaLocal(event) {
  const payment =
    event?.payment || {};

  const checkout =
    event?.checkout || {};

  const subscriptionAsaas =
    event?.subscription || {};

  const externalReference =
    checkout.externalReference ||
    payment.externalReference ||
    subscriptionAsaas.externalReference;

  const checkoutId =
    checkout.id;

  const subscriptionIdAsaas =
    subscriptionAsaas.id ||
    payment.subscription;

  // ----------------------------------------------------------
  // 1. EXTERNAL REFERENCE
  // ----------------------------------------------------------

  if (externalReference) {
    const local = await new Promise(
      (resolve, reject) => {
        db.get(
          `
          SELECT *
          FROM subscriptions
          WHERE id = ?
          LIMIT 1
          `,
          [externalReference],
          (err, row) => {
            if (err) return reject(err);
            resolve(row);
          }
        );
      }
    );

    if (local) {
      return local;
    }
  }

  // ----------------------------------------------------------
  // 2. CHECKOUT ID
  // ----------------------------------------------------------

  if (checkoutId) {
    const local = await new Promise(
      (resolve, reject) => {
        db.get(
          `
          SELECT *
          FROM subscriptions
          WHERE external_payment_id = ?
          LIMIT 1
          `,
          [checkoutId],
          (err, row) => {
            if (err) return reject(err);
            resolve(row);
          }
        );
      }
    );

    if (local) {
      return local;
    }
  }

  // ----------------------------------------------------------
  // 3. ID DA ASSINATURA ASAAS
  // ----------------------------------------------------------

  if (subscriptionIdAsaas) {
    const local = await new Promise(
      (resolve, reject) => {
        db.get(
          `
          SELECT *
          FROM subscriptions
          WHERE external_subscription_id = ?
          LIMIT 1
          `,
          [subscriptionIdAsaas],
          (err, row) => {
            if (err) return reject(err);
            resolve(row);
          }
        );
      }
    );

    if (local) {
      return local;
    }
  }

  return null;
}

// ============================================================
// WEBHOOK ASAAS
// ============================================================

async function processarWebhookAsaas(
  req,
  res
) {
  try {

    // --------------------------------------------------------
    // VALIDAR TOKEN
    // --------------------------------------------------------

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

    const evento = req.body || {};

    console.log(
      "Webhook Asaas recebido:",
      evento.event
    );

    // --------------------------------------------------------
    // LOCALIZAR ASSINATURA
    // --------------------------------------------------------

    const assinatura =
      await encontrarAssinaturaLocal(
        evento
      );

    if (!assinatura) {
      console.warn(
        "Assinatura local não encontrada.",
        {
          event: evento.event,
          payment: evento.payment?.id,
          checkout: evento.checkout?.id,
          subscription:
            evento.subscription?.id ||
            evento.payment?.subscription
        }
      );

      // Retorna 200 para o Asaas não ficar
      // reenviando indefinidamente eventos
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

      let expiresAt =
        assinatura.expires_at
          ? new Date(
              assinatura.expires_at
            )
          : null;

      if (!expiresAt) {
        expiresAt =
          adicionarUmMes(agora);
      }

      await new Promise(
        (resolve, reject) => {
          db.run(
            `
            UPDATE subscriptions
            SET status = 'ACTIVE',
                started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                expires_at = ?,
                external_subscription_id = COALESCE(?, external_subscription_id),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
              expiresAt.toISOString(),
              evento.subscription?.id ||
              evento.checkout?.subscription ||
              null,
              assinatura.id
            ],
            err => {
              if (err) return reject(err);
              resolve();
            }
          );
        }
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

      if (
        asaasSubscriptionId
      ) {

        await new Promise(
          (resolve, reject) => {
            db.run(
              `
              UPDATE subscriptions
              SET external_subscription_id = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
              `,
              [
                asaasSubscriptionId,
                assinatura.id
              ],
              err => {
                if (err) return reject(err);
                resolve();
              }
            );
          }
        );

        console.log(
          `Assinatura Asaas ${asaasSubscriptionId} vinculada à assinatura local ${assinatura.id}`
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

      let novaData;

      if (dueDate) {
        novaData =
          adicionarUmMes(
            new Date(dueDate)
          );
      } else {
        novaData =
          adicionarUmMes(
            new Date()
          );
      }

      const atual =
        assinatura.expires_at
          ? new Date(
              assinatura.expires_at
            )
          : null;

      // Evita aumentar a validade duas vezes
      // caso o webhook seja entregue novamente.
      if (
        !atual ||
        novaData > atual
      ) {

        await new Promise(
          (resolve, reject) => {
            db.run(
              `
              UPDATE subscriptions
              SET status = 'ACTIVE',
                  expires_at = ?,
                  external_subscription_id = COALESCE(?, external_subscription_id),
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
              `,
              [
                novaData.toISOString(),

                payment.subscription ||
                null,

                assinatura.id
              ],
              err => {
                if (err) return reject(err);
                resolve();
              }
            );
          }
        );
      } else {

        await new Promise(
          (resolve, reject) => {
            db.run(
              `
              UPDATE subscriptions
              SET status = 'ACTIVE',
                  external_subscription_id = COALESCE(?, external_subscription_id),
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
              `,
              [
                payment.subscription ||
                null,

                assinatura.id
              ],
              err => {
                if (err) return reject(err);
                resolve();
              }
            );
          }
        );
      }

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

      // Se ainda estiver pendente,
      // podemos ativar como fallback.
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

        await new Promise(
          (resolve, reject) => {
            db.run(
              `
              UPDATE subscriptions
              SET status = 'ACTIVE',
                  started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                  expires_at = ?,
                  external_subscription_id = COALESCE(?, external_subscription_id),
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
              `,
              [
                expiresAt.toISOString(),

                evento.payment?.subscription ||
                null,

                assinatura.id
              ],
              err => {
                if (err) return reject(err);
                resolve();
              }
            );
          }
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

      await new Promise(
        (resolve, reject) => {
          db.run(
            `
            UPDATE subscriptions
            SET status = 'PENDING',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [assinatura.id],
            err => {
              if (err) return reject(err);
              resolve();
            }
          );
        }
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

      await new Promise(
        (resolve, reject) => {
          db.run(
            `
            UPDATE subscriptions
            SET status = 'CANCELLED',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND status = 'PENDING'
            `,
            [assinatura.id],
            err => {
              if (err) return reject(err);
              resolve();
            }
          );
        }
      );
    }

    // ========================================================
    // CHECKOUT EXPIRADO
    // ========================================================

    else if (
      event === "CHECKOUT_EXPIRED"
    ) {

      await new Promise(
        (resolve, reject) => {
          db.run(
            `
            UPDATE subscriptions
            SET status = 'EXPIRED',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND status = 'PENDING'
            `,
            [assinatura.id],
            err => {
              if (err) return reject(err);
              resolve();
            }
          );
        }
      );
    }

    // ========================================================
    // ASSINATURA INATIVADA
    // ========================================================

    else if (
      event ===
        "SUBSCRIPTION_INACTIVATED" ||
      event ===
        "SUBSCRIPTION_DELETED"
    ) {

      await new Promise(
        (resolve, reject) => {
          db.run(
            `
            UPDATE subscriptions
            SET status = 'CANCELLED',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [assinatura.id],
            err => {
              if (err) return reject(err);
              resolve();
            }
          );
        }
      );

      console.log(
        `Assinatura ${assinatura.id} cancelada`
      );
    }

    // ========================================================
    // ESTORNO
    // ========================================================

    else if (
      event ===
        "PAYMENT_REFUNDED" ||
      event ===
        "PAYMENT_CHARGEBACK_REQUESTED"
    ) {

      await new Promise(
        (resolve, reject) => {
          db.run(
            `
            UPDATE subscriptions
            SET status = 'CANCELLED',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [assinatura.id],
            err => {
              if (err) return reject(err);
              resolve();
            }
          );
        }
      );

      console.log(
        `Pagamento estornado/chargeback: assinatura ${assinatura.id}`
      );
    }

    // ========================================================
    // OUTROS EVENTOS
    // ========================================================

    else {

      console.log(
        `Evento Asaas recebido sem ação específica: ${event}`
      );
    }

    // ========================================================
    // RESPONDER ASAAS
    // ========================================================

    return res.json({
      ok: true
    });

  } catch (error) {

    console.error(
      "Erro ao processar webhook Asaas:",
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
// WEBHOOK ASAAS - PRINCIPAL
// ============================================================

router.post(
  "/webhook/asaas",
  processarWebhookAsaas
);

// ============================================================
// WEBHOOK ASAAS - ALIAS
// Mantido para compatibilidade
// ============================================================

router.post(
  "/webhook",
  processarWebhookAsaas
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
