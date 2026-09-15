const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();


// ============================================================
// CONFIGURAÇÃO ASAAS
// ============================================================

const ASAAS_API_URL =
  process.env.ASAAS_API_URL ||
  "https://api.asaas.com/v3";

const ASAAS_API_KEY =
  process.env.ASAAS_API_KEY;

const ASAAS_WEBHOOK_TOKEN =
  process.env.ASAAS_WEBHOOK_TOKEN;

const BASE_URL =
  "https://site--painel-binance--clbfrw28wcz.code.run";


// ============================================================
// CONFIGURAÇÃO DOS PLANOS
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
// FUNÇÃO PARA FAZER REQUISIÇÕES AO ASAAS
// ============================================================

async function asaasRequest(path, options = {}) {

  if (!ASAAS_API_KEY) {

    throw new Error(
      "ASAAS_API_KEY não está configurada no servidor."
    );

  }


  const response = await fetch(
    `${ASAAS_API_URL}${path}`,
    {

      method:
        options.method || "GET",

      headers: {

        "Content-Type":
          "application/json",

        "Accept":
          "application/json",

        "access_token":
          ASAAS_API_KEY

      },

      body:
        options.body
          ? JSON.stringify(options.body)
          : undefined

    }
  );


  const text =
    await response.text();


  let data = {};


  try {

    data =
      text
        ? JSON.parse(text)
        : {};

  } catch {

    data = {
      raw: text
    };

  }


  if (!response.ok) {

    console.error(
      "ERRO API ASAAS:",
      response.status,
      JSON.stringify(
        data,
        null,
        2
      )
    );


    const error =
      new Error(

        data?.errors?.[0]?.description ||

        data?.message ||

        "Erro ao comunicar com o Asaas."

      );


    error.status =
      response.status;

    error.data =
      data;


    throw error;

  }


  return data;

}


// ============================================================
// LIMPAR CPF / CNPJ / TELEFONE
// ============================================================

function somenteNumeros(valor) {

  return String(
    valor || ""
  ).replace(
    /\D/g,
    ""
  );

}


// ============================================================
// TESTE DA ROTA
// ============================================================

router.get(
  "/teste",
  (req, res) => {

    return res.json({

      success: true,

      message:
        "Rota de assinatura funcionando com Asaas."

    });

  }
);


// ============================================================
// TESTE ANTIGO DO MERCADO PAGO
// ============================================================
//
// Mantemos a rota para evitar quebrar alguma chamada antiga.
// O Mercado Pago não será mais utilizado.
//
// ============================================================

router.get(
  "/teste-mercadopago",
  (req, res) => {

    return res.json({

      success: false,

      provider:
        "ASAAS",

      message:
        "Mercado Pago foi desativado. O sistema utiliza Asaas."

    });

  }
);


// ============================================================
// BUSCAR PLANOS
// ============================================================

router.get(
  "/plans",
  (req, res) => {

    return res.json({

      success: true,

      plans:

        Object.entries(
          PLANOS
        ).map(
          ([codigo, plano]) => ({

            code:
              codigo,

            name:
              plano.nome,

            price:
              plano.valor,

            simultaneousOperations:
              plano.operacoesSimultaneas,

            binanceAccounts:
              plano.contasBinance

          })
        )

    });

  }
);


// ============================================================
// SELECIONAR PLANO
// ============================================================
//
// Fluxo:
//
// 1. Usuário escolhe plano
// 2. Sistema cria assinatura PENDING
// 3. Sistema cria Checkout no Asaas
// 4. Cliente vai para Checkout seguro
// 5. Asaas envia Webhook
// 6. Sistema altera para ACTIVE
//
// ============================================================

router.post(
  "/select",
  authMiddleware,
  async (req, res) => {

    try {

      const userId =
        req.user.id;


      const planCode =
        String(
          req.body?.plan || ""
        )
        .trim()
        .toLowerCase();


      // ------------------------------------------------------
      // VALIDAR PLANO
      // ------------------------------------------------------

      if (!PLANOS[planCode]) {

        return res.status(400).json({

          success: false,

          message:
            "Plano inválido. Escolha Básico, Profissional ou Premium."

        });

      }


      const plano =
        PLANOS[planCode];


      // ------------------------------------------------------
      // BUSCAR USUÁRIO
      // ------------------------------------------------------

      const userResult =
        await db.query(

          `
          SELECT
            id,
            name,
            email,
            active
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

          success: false,

          message:
            "Usuário não encontrado."

        });

      }


      const user =
        userResult.rows[0];


      // ------------------------------------------------------
      // VERIFICAR USUÁRIO ATIVO
      // ------------------------------------------------------

      if (!user.active) {

        return res.status(403).json({

          success: false,

          message:
            "Usuário inativo."

        });

      }


      // ------------------------------------------------------
      // VERIFICAR ASSINATURA ATIVA
      // ------------------------------------------------------

      const activeResult =
        await db.query(

          `
          SELECT
            id,
            plan,
            status,
            amount,
            expires_at
          FROM subscriptions
          WHERE user_id = $1
            AND status = 'ACTIVE'
          ORDER BY created_at DESC
          LIMIT 1
          `,

          [userId]

        );


      if (
        activeResult.rows.length > 0
      ) {

        const activeSubscription =
          activeResult.rows[0];


        // --------------------------------------------------
        // MESMO PLANO
        // --------------------------------------------------

        if (
          activeSubscription.plan ===
          planCode
        ) {

          return res.status(409).json({

            success: false,

            message:
              "Você já possui este plano ativo.",

            subscription: {

              id:
                activeSubscription.id,

              plan:
                activeSubscription.plan,

              status:
                activeSubscription.status,

              amount:
                activeSubscription.amount,

              expiresAt:
                activeSubscription.expires_at

            }

          });

        }


        // --------------------------------------------------
        // OUTRO PLANO ATIVO
        // --------------------------------------------------

        return res.status(409).json({

          success: false,

          message:
            "Você já possui uma assinatura ativa. O novo plano poderá ser contratado após o tratamento da assinatura atual.",

          currentPlan:
            activeSubscription.plan

        });

      }


      // ------------------------------------------------------
      // DADOS DO CLIENTE
      // ------------------------------------------------------

      const customerData =
        req.body?.customerData || {};


      const customerName =
        String(
          customerData.name || ""
        ).trim();


      const customerCpfCnpj =
        somenteNumeros(
          customerData.cpfCnpj
        );


      const customerEmail =
        String(
          customerData.email ||
          user.email ||
          ""
        ).trim();


      const customerPhone =
        somenteNumeros(
          customerData.phone
        );


      // ------------------------------------------------------
      // VALIDAR DADOS
      // ------------------------------------------------------

      if (
        !customerName ||
        !customerCpfCnpj ||
        !customerEmail ||
        !customerPhone
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Informe nome, CPF/CNPJ, e-mail e telefone."

        });

      }


      // ------------------------------------------------------
      // VALIDAR CPF/CNPJ
      // ------------------------------------------------------

      if (
        customerCpfCnpj.length !== 11 &&
        customerCpfCnpj.length !== 14
      ) {

        return res.status(400).json({

          success: false,

          message:
            "CPF/CNPJ inválido."

        });

      }


      // ------------------------------------------------------
      // VALIDAR TELEFONE
      // ------------------------------------------------------

      if (
        customerPhone.length < 10
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Telefone inválido."

        });

      }


      // ------------------------------------------------------
      // VERIFICAR PENDING ASAAS
      // ------------------------------------------------------

      const pendingResult =
        await db.query(

          `
          SELECT
            id,
            plan,
            status,
            amount,
            payment_provider,
            external_payment_id,
            external_subscription_id,
            payment_method,
            started_at,
            expires_at,
            created_at
          FROM subscriptions
          WHERE user_id = $1
            AND plan = $2
            AND status = 'PENDING'
            AND payment_provider = 'ASAAS'
          ORDER BY created_at DESC
          LIMIT 1
          `,

          [
            userId,
            planCode
          ]

        );


      // ------------------------------------------------------
      // SE JÁ EXISTIR CHECKOUT ASAAS
      // ------------------------------------------------------

      if (
        pendingResult.rows.length > 0
      ) {

        const pending =
          pendingResult.rows[0];


        // Se ainda temos o ID do Checkout,
        // podemos reutilizar o link.

        if (
          pending.external_payment_id
        ) {

          const paymentUrl =
            `https://asaas.com/checkoutSession/show?id=${encodeURIComponent(
              pending.external_payment_id
            )}`;


          return res.json({

            success: true,

            message:
              "Existe uma contratação pendente para este plano.",

            requiresPayment:
              true,

            paymentUrl:
              paymentUrl,

            subscription: {

              id:
                pending.id,

              plan:
                pending.plan,

              planName:
                plano.nome,

              status:
                pending.status,

              amount:
                pending.amount,

              paymentProvider:
                pending.payment_provider,

              paymentMethod:
                pending.payment_method,

              externalPaymentId:
                pending.external_payment_id,

              externalSubscriptionId:
                pending.external_subscription_id,

              startedAt:
                pending.started_at,

              expiresAt:
                pending.expires_at,

              createdAt:
                pending.created_at

            }

          });

        }

      }


      // ------------------------------------------------------
      // CRIAR ASSINATURA LOCAL
      // ------------------------------------------------------

      const result =
        await db.query(

          `
          INSERT INTO subscriptions (
            user_id,
            plan,
            status,
            amount,
            payment_provider,
            payment_method
          )
          VALUES (
            $1,
            $2,
            'PENDING',
            $3,
            'ASAAS',
            'ASAAS_CHECKOUT'
          )
          RETURNING
            id,
            user_id,
            plan,
            status,
            amount,
            payment_provider,
            payment_method,
            created_at
          `,

          [
            userId,
            planCode,
            plano.valor
          ]

        );


      const subscription =
        result.rows[0];


      // ------------------------------------------------------
      // PRIMEIRA COBRANÇA
      // ------------------------------------------------------
      //
      // Amanhã.
      //
      // O Asaas exige uma data para a primeira cobrança
      // quando chargeTypes = RECURRENT.
      //
      // ------------------------------------------------------

      const nextDueDate =
        new Date();


      nextDueDate.setDate(
        nextDueDate.getDate() + 1
      );


      const nextDueDateString =
        nextDueDate
          .toISOString()
          .split("T")[0];


      // ------------------------------------------------------
      // CRIAR CHECKOUT ASAAS
      // ------------------------------------------------------

      let checkout;


      try {

        checkout =
          await asaasRequest(
            "/checkouts",
            {

              method:
                "POST",

              body: {

                // Assinatura recorrente
                // atualmente configurada para cartão.

                billingTypes: [
                  "CREDIT_CARD"
                ],

                chargeTypes: [
                  "RECURRENT"
                ],

                minutesToExpire:
                  60,

                externalReference:
                  String(
                    subscription.id
                  ),

                callback: {

                  successUrl:
                    `${BASE_URL}/pagamento-sucesso.html?subscriptionId=${subscription.id}`,

                  cancelUrl:
                    `${BASE_URL}/pagamento.html?plan=${encodeURIComponent(
                      planCode
                    )}&cancelled=1`,

                  expiredUrl:
                    `${BASE_URL}/pagamento.html?plan=${encodeURIComponent(
                      planCode
                    )}&expired=1`

                },

                items: [

                  {

                    name:
                      `CriptoPro ${plano.nome}`,

                    description:
                      `Assinatura mensal CriptoPro - Plano ${plano.nome}`,

                    quantity:
                      1,

                    value:
                      Number(
                        plano.valor
                      )

                  }

                ],

                customerData: {

                  name:
                    customerName,

                  cpfCnpj:
                    customerCpfCnpj,

                  email:
                    customerEmail,

                  phone:
                    customerPhone

                },

                subscription: {

                  cycle:
                    "MONTHLY",

                  nextDueDate:
                    nextDueDateString

                }

              }

            }

          );

      } catch (asaasError) {

        console.error(
          "ERRO AO CRIAR CHECKOUT ASAAS:",
          asaasError
        );


        // Remover a assinatura local criada
        // caso o Checkout não tenha sido criado.

        await db.query(

          `
          DELETE FROM subscriptions
          WHERE id = $1
          `,

          [
            subscription.id
          ]

        );


        return res.status(
          asaasError.status || 502
        ).json({

          success: false,

          message:
            asaasError.message ||
            "Não foi possível iniciar o pagamento no Asaas."

        });

      }


      // ------------------------------------------------------
      // LOG DO CHECKOUT
      // ------------------------------------------------------

      console.log(
        "CHECKOUT ASAAS CRIADO:",
        JSON.stringify(
          checkout,
          null,
          2
        )
      );


      // ------------------------------------------------------
      // ID DO CHECKOUT
      // ------------------------------------------------------

      const checkoutId =
        checkout?.id
          ? String(
              checkout.id
            )
          : null;


      if (!checkoutId) {

        console.error(
          "ASAAS NÃO RETORNOU ID DO CHECKOUT:",
          checkout
        );


        await db.query(

          `
          DELETE FROM subscriptions
          WHERE id = $1
          `,

          [
            subscription.id
          ]

        );


        return res.status(502).json({

          success: false,

          message:
            "O Asaas não retornou o identificador do Checkout."

        });

      }


      // ------------------------------------------------------
      // LINK DO CHECKOUT
      // ------------------------------------------------------
      //
      // Algumas respostas retornam link.
      // Se não retornar, montamos usando o ID.
      //
      // ------------------------------------------------------

      const paymentUrl =
        checkout.link ||
        checkout.paymentUrl ||
        `https://asaas.com/checkoutSession/show?id=${encodeURIComponent(
          checkoutId
        )}`;


      // ------------------------------------------------------
      // SALVAR CHECKOUT
      // ------------------------------------------------------

      const updatedSubscription =
        await db.query(

          `
          UPDATE subscriptions
          SET
            payment_provider =
              'ASAAS',

            external_payment_id =
              $1,

            payment_method =
              'ASAAS_CHECKOUT',

            updated_at =
              NOW()

          WHERE id = $2

          RETURNING
            id,
            user_id,
            plan,
            status,
            amount,
            payment_provider,
            external_payment_id,
            external_subscription_id,
            payment_method,
            started_at,
            expires_at,
            created_at,
            updated_at
          `,

          [
            checkoutId,
            subscription.id
          ]

        );


      const subscriptionAtualizada =
        updatedSubscription.rows[0];


      // ------------------------------------------------------
      // RESPOSTA
      // ------------------------------------------------------

      return res.status(201).json({

        success: true,

        message:
          "Contratação criada. Prossiga para o pagamento.",

        requiresPayment:
          true,

        paymentUrl:
          paymentUrl,

        subscription: {

          id:
            subscriptionAtualizada.id,

          plan:
            subscriptionAtualizada.plan,

          planName:
            plano.nome,

          status:
            subscriptionAtualizada.status,

          amount:
            subscriptionAtualizada.amount,

          simultaneousOperations:
            plano.operacoesSimultaneas,

          binanceAccounts:
            plano.contasBinance,

          paymentProvider:
            subscriptionAtualizada.payment_provider,

          paymentMethod:
            subscriptionAtualizada.payment_method,

          externalPaymentId:
            subscriptionAtualizada.external_payment_id,

          externalSubscriptionId:
            subscriptionAtualizada.external_subscription_id,

          startedAt:
            subscriptionAtualizada.started_at,

          expiresAt:
            subscriptionAtualizada.expires_at,

          createdAt:
            subscriptionAtualizada.created_at

        }

      });

    } catch (error) {

      console.error(
        "ERRO AO SELECIONAR PLANO:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Erro interno ao selecionar o plano."

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
        req.user.id;


      const result =
        await db.query(

          `
          SELECT
            id,
            user_id,
            plan,
            status,
            amount,
            payment_provider,
            external_payment_id,
            external_subscription_id,
            payment_method,
            started_at,
            expires_at,
            created_at,
            updated_at
          FROM subscriptions
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 1
          `,

          [userId]

        );


      // ------------------------------------------------------
      // SEM ASSINATURA
      // ------------------------------------------------------

      if (
        result.rows.length === 0
      ) {

        return res.json({

          success: true,

          hasSubscription:
            false,

          active:
            false,

          plan:
            null,

          planName:
            null,

          status:
            null,

          amount:
            null,

          paymentMethod:
            null,

          expiresAt:
            null,

          message:
            "Nenhuma assinatura encontrada."

        });

      }


      const subscription =
        result.rows[0];


      // ------------------------------------------------------
      // VERIFICAR STATUS
      // ------------------------------------------------------

      let active =
        subscription.status ===
        "ACTIVE";


      // ------------------------------------------------------
      // VERIFICAR VENCIMENTO
      // ------------------------------------------------------

      if (
        active &&
        subscription.expires_at
      ) {

        const agora =
          new Date();


        const vencimento =
          new Date(
            subscription.expires_at
          );


        if (
          vencimento <= agora
        ) {

          active =
            false;


          await db.query(

            `
            UPDATE subscriptions
            SET
              status = 'EXPIRED',
              updated_at = NOW()
            WHERE id = $1
            `,

            [
              subscription.id
            ]

          );


          subscription.status =
            "EXPIRED";

        }

      }


      // ------------------------------------------------------
      // PLANO
      // ------------------------------------------------------

      const plano =
        PLANOS[
          subscription.plan
        ] || null;


      // ------------------------------------------------------
      // RESPOSTA
      // ------------------------------------------------------

      return res.json({

        success: true,

        hasSubscription:
          true,

        active:
          active,

        subscriptionId:
          subscription.id,

        plan:
          subscription.plan,

        planName:
          plano
            ? plano.nome
            : subscription.plan,

        status:
          subscription.status,

        amount:
          subscription.amount,

        paymentProvider:
          subscription.payment_provider,

        paymentMethod:
          subscription.payment_method,

        startedAt:
          subscription.started_at,

        expiresAt:
          subscription.expires_at,

        limits:

          plano

            ? {

                simultaneousOperations:
                  plano.operacoesSimultaneas,

                binanceAccounts:
                  plano.contasBinance

              }

            : null

      });

    } catch (error) {

      console.error(
        "ERRO AO CONSULTAR ASSINATURA:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Erro interno ao consultar assinatura."

      });

    }

  }
);


// ============================================================
// WEBHOOK ASAAS
// ============================================================
//
// O Asaas envia o token no header:
//
// asaas-access-token
//
// Eventos principais:
//
// CHECKOUT_PAID
// CHECKOUT_CANCELED
// CHECKOUT_EXPIRED
// SUBSCRIPTION_CREATED
// SUBSCRIPTION_INACTIVATED
// SUBSCRIPTION_DELETED
// PAYMENT_RECEIVED
// PAYMENT_CONFIRMED
// PAYMENT_OVERDUE
//
// ============================================================

async function processarWebhookAsaas(
  req,
  res
) {

  try {

    // --------------------------------------------------------
    // VALIDAR TOKEN
    // --------------------------------------------------------

    const token =
      req.headers[
        "asaas-access-token"
      ];


    if (
      !ASAAS_WEBHOOK_TOKEN
    ) {

      console.error(
        "ASAAS_WEBHOOK_TOKEN não configurado."
      );

      return res.sendStatus(500);

    }


    if (
      token !==
      ASAAS_WEBHOOK_TOKEN
    ) {

      console.warn(
        "WEBHOOK ASAAS RECUSADO: TOKEN INVÁLIDO."
      );

      return res.sendStatus(401);

    }


    // --------------------------------------------------------
    // RECEBER EVENTO
    // --------------------------------------------------------

    const event =
      req.body || {};


    console.log(
      "WEBHOOK ASAAS RECEBIDO:",
      JSON.stringify(
        event,
        null,
        2
      )
    );


    const eventType =
      event.event;


    const checkout =
      event.checkout ||
      {};


    const payment =
      event.payment ||
      {};


    const subscriptionData =
      event.subscription ||
      {};


    // --------------------------------------------------------
    // IDENTIFICAR ASSINATURA LOCAL
    // --------------------------------------------------------

    let localSubscriptionId =
      null;


    // Primeiro:
    // externalReference do Checkout

    const externalReference =
      checkout.externalReference ||
      subscriptionData.externalReference ||
      payment.externalReference ||
      null;


    if (
      externalReference
    ) {

      const parsed =
        Number(
          externalReference
        );


      if (
        Number.isInteger(parsed) &&
        parsed > 0
      ) {

        localSubscriptionId =
          parsed;

      }

    }


    // --------------------------------------------------------
    // TENTAR PELO CHECKOUT ID
    // --------------------------------------------------------

    if (
      !localSubscriptionId &&
      checkout.id
    ) {

      const result =
        await db.query(

          `
          SELECT id
          FROM subscriptions
          WHERE external_payment_id = $1
          LIMIT 1
          `,

          [
            String(
              checkout.id
            )
          ]

        );


      if (
        result.rows.length > 0
      ) {

        localSubscriptionId =
          result.rows[0].id;

      }

    }


    // --------------------------------------------------------
    // TENTAR PELA ASSINATURA ASAAS
    // --------------------------------------------------------

    if (
      !localSubscriptionId &&
      subscriptionData.id
    ) {

      const result =
        await db.query(

          `
          SELECT id
          FROM subscriptions
          WHERE external_subscription_id = $1
          LIMIT 1
          `,

          [
            String(
              subscriptionData.id
            )
          ]

        );


      if (
        result.rows.length > 0
      ) {

        localSubscriptionId =
          result.rows[0].id;

      }

    }


    // --------------------------------------------------------
    // TENTAR PELO PAYMENT.SUBSCRIPTION
    // --------------------------------------------------------

    if (
      !localSubscriptionId &&
      payment.subscription
    ) {

      const result =
        await db.query(

          `
          SELECT id
          FROM subscriptions
          WHERE external_subscription_id = $1
          LIMIT 1
          `,

          [
            String(
              payment.subscription
            )
          ]

        );


      if (
        result.rows.length > 0
      ) {

        localSubscriptionId =
          result.rows[0].id;

      }

    }


    // --------------------------------------------------------
    // EVENTO SEM ASSINATURA LOCAL
    // --------------------------------------------------------

    if (
      !localSubscriptionId
    ) {

      console.warn(
        "WEBHOOK ASAAS SEM ASSINATURA LOCAL:",
        eventType
      );


      return res.sendStatus(200);

    }


    // ========================================================
    // CHECKOUT PAGO
    // ========================================================

    if (
      eventType ===
      "CHECKOUT_PAID"
    ) {

      await db.query(

        `
        UPDATE subscriptions
        SET

          status =
            'ACTIVE',

          started_at =
            COALESCE(
              started_at,
              NOW()
            ),

          expires_at =
            NOW() + INTERVAL '1 month',

          external_payment_id =
            COALESCE(
              external_payment_id,
              $1
            ),

          updated_at =
            NOW()

        WHERE id = $2
        `,

        [
          checkout.id
            ? String(
                checkout.id
              )
            : null,

          localSubscriptionId
        ]

      );


      console.log(
        "ASSINATURA ATIVADA PELO CHECKOUT:",
        localSubscriptionId
      );

    }


    // ========================================================
    // ASSINATURA ASAAS CRIADA
    // ========================================================

    if (
      eventType ===
      "SUBSCRIPTION_CREATED"
    ) {

      if (
        subscriptionData.id
      ) {

        await db.query(

          `
          UPDATE subscriptions
          SET

            external_subscription_id =
              $1,

            updated_at =
              NOW()

          WHERE id = $2
          `,

          [
            String(
              subscriptionData.id
            ),

            localSubscriptionId
          ]

        );


        console.log(
          "ID DA ASSINATURA ASAAS SALVO:",
          subscriptionData.id
        );

      }

    }


    // ========================================================
    // PAGAMENTO RECORRENTE RECEBIDO
    // ========================================================

    if (
      eventType ===
      "PAYMENT_RECEIVED"
    ) {

      await db.query(

        `
        UPDATE subscriptions
        SET

          status =
            'ACTIVE',

          expires_at =
            CASE

              WHEN expires_at IS NULL
                THEN NOW() + INTERVAL '1 month'

              WHEN expires_at < NOW()
                THEN NOW() + INTERVAL '1 month'

              ELSE
                expires_at + INTERVAL '1 month'

            END,

          updated_at =
            NOW()

        WHERE id = $1
        `,

        [
          localSubscriptionId
        ]

      );


      console.log(
        "PAGAMENTO RECORRENTE RECEBIDO:",
        localSubscriptionId
      );

    }


    // ========================================================
    // PAGAMENTO CONFIRMADO
    // ========================================================
    //
    // Não altera expires_at aqui.
    //
    // Para cartão, o Asaas pode enviar PAYMENT_CONFIRMED
    // antes de PAYMENT_RECEIVED.
    //
    // ========================================================

    if (
      eventType ===
      "PAYMENT_CONFIRMED"
    ) {

      await db.query(

        `
        UPDATE subscriptions
        SET

          status =
            CASE

              WHEN status = 'PENDING'
                THEN 'ACTIVE'

              ELSE status

            END,

          started_at =
            CASE

              WHEN status = 'PENDING'
                THEN COALESCE(
                  started_at,
                  NOW()
                )

              ELSE started_at

            END,

          expires_at =
            CASE

              WHEN status = 'PENDING'
                THEN COALESCE(
                  expires_at,
                  NOW() + INTERVAL '1 month'
                )

              ELSE expires_at

            END,

          updated_at =
            NOW()

        WHERE id = $1
        `,

        [
          localSubscriptionId
        ]

      );

    }


    // ========================================================
    // PAGAMENTO VENCIDO
    // ========================================================

    if (
      eventType ===
      "PAYMENT_OVERDUE"
    ) {

      await db.query(

        `
        UPDATE subscriptions
        SET

          status =
            'PENDING',

          updated_at =
            NOW()

        WHERE id = $1
        `,

        [
          localSubscriptionId
        ]

      );


      console.log(
        "PAGAMENTO VENCIDO:",
        localSubscriptionId
      );

    }


    // ========================================================
    // CHECKOUT CANCELADO
    // ========================================================

    if (
      eventType ===
      "CHECKOUT_CANCELED"
    ) {

      await db.query(

        `
        UPDATE subscriptions
        SET

          status =
            'CANCELLED',

          updated_at =
            NOW()

        WHERE id = $1
          AND status = 'PENDING'
        `,

        [
          localSubscriptionId
        ]

      );

    }


    // ========================================================
    // CHECKOUT EXPIRADO
    // ========================================================

    if (
      eventType ===
      "CHECKOUT_EXPIRED"
    ) {

      await db.query(

        `
        UPDATE subscriptions
        SET

          status =
            'EXPIRED',

          updated_at =
            NOW()

        WHERE id = $1
          AND status = 'PENDING'
        `,

        [
          localSubscriptionId
        ]

      );

    }


    // ========================================================
    // ASSINATURA INATIVADA
    // ========================================================

    if (
      eventType ===
        "SUBSCRIPTION_INACTIVATED" ||

      eventType ===
        "SUBSCRIPTION_DELETED"
    ) {

      await db.query(

        `
        UPDATE subscriptions
        SET

          status =
            'CANCELLED',

          updated_at =
            NOW()

        WHERE id = $1
        `,

        [
          localSubscriptionId
        ]

      );


      console.log(
        "ASSINATURA ASAAS CANCELADA:",
        localSubscriptionId
      );

    }


    // --------------------------------------------------------
    // RESPONDER ASAAS
    // --------------------------------------------------------

    return res.sendStatus(200);

  } catch (error) {

    console.error(
      "ERRO NO WEBHOOK ASAAS:",
      error
    );


    return res.sendStatus(500);

  }

}


// ============================================================
// WEBHOOK PRINCIPAL
// ============================================================
//
// Mantemos /webhook porque essa rota já existia.
//
// ============================================================

router.post(
  "/webhook",
  processarWebhookAsaas
);


// ============================================================
// WEBHOOK EXPLÍCITO ASAAS
// ============================================================
//
// Também disponibilizamos:
//
// /webhook/asaas
//
// ============================================================

router.post(
  "/webhook/asaas",
  processarWebhookAsaas
);


// ============================================================
// EXPORTAR
// ============================================================

module.exports = router;
