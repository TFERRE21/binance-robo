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
// FUNÇÃO - REQUISIÇÃO ASAAS
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
        options.body !== undefined
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
// FUNÇÃO - SOMENTE NÚMEROS
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
// FUNÇÃO - DATA PARA ASAAS
// ============================================================

function dataAsaas(diasAdicionar = 1) {

  const data =
    new Date();

  data.setDate(
    data.getDate() +
    diasAdicionar
  );


  const ano =
    data.getFullYear();

  const mes =
    String(
      data.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const dia =
    String(
      data.getDate()
    ).padStart(
      2,
      "0"
    );


  return `${ano}-${mes}-${dia}`;

}


// ============================================================
// FUNÇÃO - LINK DO CHECKOUT
// ============================================================

function gerarLinkCheckout(
  checkoutId
) {

  if (!checkoutId) {
    return null;
  }


  return (
    `https://asaas.com/checkoutSession/show?id=${encodeURIComponent(
      checkoutId
    )}`
  );

}


// ============================================================
// TESTE DA ROTA
// ============================================================

router.get(
  "/teste",
  (req, res) => {

    return res.json({

      success:
        true,

      provider:
        "ASAAS",

      message:
        "Rota de assinatura funcionando com Asaas."

    });

  }
);


// ============================================================
// COMPATIBILIDADE COM TESTE ANTIGO DO MERCADO PAGO
// ============================================================

router.get(
  "/teste-mercadopago",
  (req, res) => {

    return res.json({

      success:
        false,

      provider:
        "ASAAS",

      message:
        "Mercado Pago não é mais utilizado neste módulo."

    });

  }
);


// ============================================================
// LISTAR PLANOS
// ============================================================

router.get(
  "/plans",
  (req, res) => {

    return res.json({

      success:
        true,

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
// Usuário
//   ↓
// /select
//   ↓
// Banco PENDING
//   ↓
// Checkout Asaas
//   ↓
// Cliente paga
//   ↓
// Webhook
//   ↓
// ACTIVE
//
// ============================================================

router.post(
  "/select",
  authMiddleware,
  async (req, res) => {

    try {

      // ------------------------------------------------------
      // USUÁRIO
      // ------------------------------------------------------

      const userId =
        req.user.id;


      // ------------------------------------------------------
      // PLANO
      // ------------------------------------------------------

      const planCode =
        String(
          req.body?.plan || ""
        )
        .trim()
        .toLowerCase();


      if (
        !PLANOS[planCode]
      ) {

        return res.status(400).json({

          success:
            false,

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

          [
            userId
          ]

        );


      if (
        userResult.rows.length === 0
      ) {

        return res.status(404).json({

          success:
            false,

          message:
            "Usuário não encontrado."

        });

      }


      const user =
        userResult.rows[0];


      // ------------------------------------------------------
      // USUÁRIO ATIVO?
      // ------------------------------------------------------

      if (
        !user.active
      ) {

        return res.status(403).json({

          success:
            false,

          message:
            "Usuário inativo."

        });

      }


      // ------------------------------------------------------
      // ASSINATURA ATIVA
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

          [
            userId
          ]

        );


      if (
        activeResult.rows.length > 0
      ) {

        const active =
          activeResult.rows[0];


        // Mesmo plano

        if (
          active.plan ===
          planCode
        ) {

          return res.status(409).json({

            success:
              false,

            message:
              "Você já possui este plano ativo.",

            subscription: {

              id:
                active.id,

              plan:
                active.plan,

              status:
                active.status,

              amount:
                active.amount,

              expiresAt:
                active.expires_at

            }

          });

        }


        // Outro plano

        return res.status(409).json({

          success:
            false,

          message:
            "Você já possui uma assinatura ativa. O novo plano poderá ser contratado após o tratamento da assinatura atual.",

          currentPlan:
            active.plan

        });

      }


      // ------------------------------------------------------
      // DADOS DO CLIENTE
      // ------------------------------------------------------

      const customerData =
        req.body?.customerData ||
        {};


      const customerName =
        String(
          customerData.name ||
          ""
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
      // VALIDAR CLIENTE
      // ------------------------------------------------------

      if (
        !customerName ||
        !customerCpfCnpj ||
        !customerEmail ||
        !customerPhone
      ) {

        return res.status(400).json({

          success:
            false,

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

          success:
            false,

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

          success:
            false,

          message:
            "Telefone inválido."

        });

      }


      // ======================================================
      // VERIFICAR CHECKOUT PENDENTE
      // ======================================================

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


      if (
        pendingResult.rows.length > 0
      ) {

        const pending =
          pendingResult.rows[0];


        // ----------------------------------------------------
        // VERIFICAR SE O CHECKOUT AINDA ESTÁ DENTRO DA
        // VALIDADE DE 60 MINUTOS
        // ----------------------------------------------------

        const criadoEm =
          pending.created_at
            ? new Date(
                pending.created_at
              )
            : null;


        const agora =
          Date.now();


        const validade =
          criadoEm
            ? criadoEm.getTime() +
              (60 * 60 * 1000)
            : 0;


        const checkoutAindaValido =
          Boolean(
            pending.external_payment_id &&
            criadoEm &&
            agora < validade
          );


        // ----------------------------------------------------
        // REUTILIZAR CHECKOUT VÁLIDO
        // ----------------------------------------------------

        if (
          checkoutAindaValido
        ) {

          return res.json({

            success:
              true,

            requiresPayment:
              true,

            reused:
              true,

            message:
              "Existe uma contratação pendente para este plano.",

            paymentUrl:
              gerarLinkCheckout(
                pending.external_payment_id
              ),

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


        // ----------------------------------------------------
        // CHECKOUT EXPIRADO
        // ----------------------------------------------------
        //
        // Não apagamos histórico.
        // Apenas marcamos a tentativa anterior como expirada.
        //
        // ----------------------------------------------------

        await db.query(

          `
          UPDATE subscriptions
          SET
            status = 'EXPIRED',
            updated_at = NOW()
          WHERE id = $1
            AND status = 'PENDING'
          `,

          [
            pending.id
          ]

        );

      }


      // ======================================================
      // CRIAR ASSINATURA LOCAL
      // ======================================================

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


      // ======================================================
      // PRIMEIRA COBRANÇA
      // ======================================================

      const nextDueDate =
        dataAsaas(1);


      // ======================================================
      // CRIAR CHECKOUT ASAAS
      // ======================================================

      let checkout;


      try {

        checkout =
          await asaasRequest(
            "/checkouts",
            {

              method:
                "POST",

              body: {

                // ------------------------------------------------
                // CARTÃO
                // ------------------------------------------------
                //
                // Recorrência automática pelo cartão.
                //
                // ------------------------------------------------

                billingTypes: [
                  "CREDIT_CARD"
                ],


                // ------------------------------------------------
                // RECORRENTE
                // ------------------------------------------------

                chargeTypes: [
                  "RECURRENT"
                ],


                // ------------------------------------------------
                // CHECKOUT EXPIRA EM 60 MINUTOS
                // ------------------------------------------------

                minutesToExpire:
                  60,


                // ------------------------------------------------
                // REFERÊNCIA DO NOSSO BANCO
                // ------------------------------------------------

                externalReference:
                  String(
                    subscription.id
                  ),


                // ------------------------------------------------
                // CALLBACKS
                // ------------------------------------------------

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


                // ------------------------------------------------
                // PRODUTO
                // ------------------------------------------------

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


                // ------------------------------------------------
                // CLIENTE
                // ------------------------------------------------

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


                // ------------------------------------------------
                // ASSINATURA
                // ------------------------------------------------

                subscription: {

                  cycle:
                    "MONTHLY",

                  nextDueDate:
                    nextDueDate

                }

              }

            }

          );

      } catch (asaasError) {

        console.error(
          "ERRO AO CRIAR CHECKOUT ASAAS:",
          asaasError
        );


        // ------------------------------------------------------
        // ROLLBACK DA ASSINATURA LOCAL
        // ------------------------------------------------------

        try {

          await db.query(

            `
            DELETE FROM subscriptions
            WHERE id = $1
            `,

            [
              subscription.id
            ]

          );

        } catch (rollbackError) {

          console.error(
            "ERRO AO DESFAZER ASSINATURA LOCAL:",
            rollbackError
          );

        }


        return res.status(
          asaasError.status ||
          502
        ).json({

          success:
            false,

          message:
            asaasError.message ||
            "Não foi possível iniciar o pagamento no Asaas."

        });

      }


      // ======================================================
      // CHECKOUT CRIADO
      // ======================================================

      console.log(
        "CHECKOUT ASAAS CRIADO:",
        JSON.stringify(
          checkout,
          null,
          2
        )
      );


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


        try {

          await db.query(

            `
            DELETE FROM subscriptions
            WHERE id = $1
            `,

            [
              subscription.id
            ]

          );

        } catch (rollbackError) {

          console.error(
            "ERRO AO DESFAZER ASSINATURA LOCAL:",
            rollbackError
          );

        }


        return res.status(502).json({

          success:
            false,

          message:
            "O Asaas não retornou o identificador do Checkout."

        });

      }


      // ======================================================
      // LINK DO CHECKOUT
      // ======================================================

      const paymentUrl =
        checkout.link ||
        checkout.paymentUrl ||
        gerarLinkCheckout(
          checkoutId
        );


      // ======================================================
      // SALVAR CHECKOUT
      // ======================================================

      const updatedSubscription =
        await db.query(

          `
          UPDATE subscriptions
          SET

            external_payment_id =
              $1,

            payment_provider =
              'ASAAS',

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


      // ======================================================
      // RESPOSTA
      // ======================================================

      return res.status(201).json({

        success:
          true,

        requiresPayment:
          true,

        reused:
          false,

        message:
          "Contratação criada. Prossiga para o pagamento.",

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


      return res.status(
        500
      ).json({

        success:
          false,

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

          [
            userId
          ]

        );


      // ------------------------------------------------------
      // SEM ASSINATURA
      // ------------------------------------------------------

      if (
        result.rows.length === 0
      ) {

        return res.json({

          success:
            true,

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

          paymentProvider:
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
      // VERIFICAR EXPIRAÇÃO
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
              AND status = 'ACTIVE'
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

        success:
          true,

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


      return res.status(
        500
      ).json({

        success:
          false,

        message:
          "Erro interno ao consultar assinatura."

      });

    }

  }
);


// ============================================================
// IDENTIFICAR ASSINATURA LOCAL PELO EVENTO
// ============================================================

async function encontrarAssinaturaLocal(
  event
) {

  const checkout =
    event.checkout ||
    {};

  const payment =
    event.payment ||
    {};

  const subscriptionData =
    event.subscription ||
    {};


  // ----------------------------------------------------------
  // 1. externalReference
  // ----------------------------------------------------------

  const externalReference =
    checkout.externalReference ||
    subscriptionData.externalReference ||
    payment.externalReference ||
    null;


  if (
    externalReference
  ) {

    const id =
      Number(
        externalReference
      );


    if (
      Number.isInteger(id) &&
      id > 0
    ) {

      const result =
        await db.query(

          `
          SELECT *
          FROM subscriptions
          WHERE id = $1
          LIMIT 1
          `,

          [
            id
          ]

        );


      if (
        result.rows.length > 0
      ) {

        return result.rows[0];

      }

    }

  }


  // ----------------------------------------------------------
  // 2. ID DO CHECKOUT
  // ----------------------------------------------------------

  if (
    checkout.id
  ) {

    const result =
      await db.query(

        `
        SELECT *
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

      return result.rows[0];

    }

  }


  // ----------------------------------------------------------
  // 3. ID DA ASSINATURA ASAAS
  // ----------------------------------------------------------

  const asaasSubscriptionId =
    subscriptionData.id ||
    payment.subscription ||
    null;


  if (
    asaasSubscriptionId
  ) {

    const result =
      await db.query(

        `
        SELECT *
        FROM subscriptions
        WHERE external_subscription_id = $1
        LIMIT 1
        `,

        [
          String(
            asaasSubscriptionId
          )
        ]

      );


    if (
      result.rows.length > 0
    ) {

      return result.rows[0];

    }

  }


  return null;

}


// ============================================================
// WEBHOOK ASAAS
// ============================================================
//
// O Asaas envia:
//
// asaas-access-token
//
// O token deve ser igual ao:
//
// ASAAS_WEBHOOK_TOKEN
//
// ============================================================

async function processarWebhookAsaas(
  req,
  res
) {

  try {

    // --------------------------------------------------------
    // TOKEN
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

      return res.sendStatus(
        500
      );

    }


    if (
      token !==
      ASAAS_WEBHOOK_TOKEN
    ) {

      console.warn(
        "WEBHOOK ASAAS RECUSADO: TOKEN INVÁLIDO."
      );

      return res.sendStatus(
        401
      );

    }


    // --------------------------------------------------------
    // EVENTO
    // --------------------------------------------------------

    const event =
      req.body ||
      {};


    const eventId =
      event.id ||
      null;


    const eventType =
      event.event ||
      null;


    console.log(
      "WEBHOOK ASAAS:",
      JSON.stringify(
        {
          id:
            eventId,

          event:
            eventType

        },
        null,
        2
      )
    );


    // --------------------------------------------------------
    // EVENTO VÁLIDO?
    // --------------------------------------------------------

    if (
      !eventType
    ) {

      console.warn(
        "Webhook Asaas sem tipo de evento."
      );

      return res.sendStatus(
        200
      );

    }


    // --------------------------------------------------------
    // LOCALIZAR ASSINATURA
    // --------------------------------------------------------

    const subscription =
      await encontrarAssinaturaLocal(
        event
      );


    if (
      !subscription
    ) {

      console.warn(
        "WEBHOOK ASAAS SEM ASSINATURA LOCAL:",
        eventType,
        eventId
      );


      // Respondemos 200 para não criar
      // uma fila infinita de reenvios para
      // eventos que não pertencem ao sistema.

      return res.sendStatus(
        200
      );

    }


    const localId =
      subscription.id;


    const checkout =
      event.checkout ||
      {};

    const payment =
      event.payment ||
      {};

    const subscriptionData =
      event.subscription ||
      {};


    // ========================================================
    // CHECKOUT PAGO
    // ========================================================
    //
    // ESTE É O EVENTO PRINCIPAL PARA ATIVAR
    // A CONTRATAÇÃO INICIAL.
    //
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
            COALESCE(
              expires_at,
              NOW() + INTERVAL '1 month'
            ),

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

          localId

        ]

      );


      console.log(
        "CHECKOUT PAGO - ASSINATURA ATIVADA:",
        localId
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

            localId

          ]

        );


        console.log(
          "ASSINATURA ASAAS REGISTRADA:",
          subscriptionData.id
        );

      }

    }


    // ========================================================
    // PAGAMENTO RECEBIDO
    // ========================================================
    //
    // O pagamento pertence a uma assinatura.
    //
    // Não fazemos:
    //
    // expires_at + 1 month
    //
    // porque o mesmo webhook pode ser reenviado.
    //
    // Em vez disso usamos a data de vencimento
    // da cobrança para determinar o próximo período.
    //
    // ========================================================

    if (
      eventType ===
      "PAYMENT_RECEIVED"
    ) {

      // ------------------------------------------------------
      // PRIMEIRO: guardar a assinatura ASAAS se disponível
      // ------------------------------------------------------

      if (
        payment.subscription
      ) {

        await db.query(

          `
          UPDATE subscriptions
          SET

            external_subscription_id =
              COALESCE(
                external_subscription_id,
                $1
              ),

            updated_at =
              NOW()

          WHERE id = $2
          `,

          [

            String(
              payment.subscription
            ),

            localId

          ]

        );

      }


      // ------------------------------------------------------
      // ATIVAR E DEFINIR VALIDADE
      // ------------------------------------------------------
      //
      // Se a cobrança tiver dueDate, usamos esse período.
      // Caso contrário, usamos NOW().
      //
      // GREATEST evita diminuir uma validade já existente.
      //
      // ------------------------------------------------------

      const dueDate =
        payment.dueDate
          ? new Date(
              `${payment.dueDate}T23:59:59`
            )
          : new Date();


      const baseDate =
        !Number.isNaN(
          dueDate.getTime()
        )
          ? dueDate
          : new Date();


      const novaData =
        new Date(
          baseDate
        );


      novaData.setMonth(
        novaData.getMonth() + 1
      );


      const novaDataISO =
        novaData.toISOString();


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
            CASE

              WHEN expires_at IS NULL
                THEN $1::timestamp

              WHEN expires_at <
                   $1::timestamp
                THEN $1::timestamp

              ELSE expires_at

            END,

          external_subscription_id =
            COALESCE(
              external_subscription_id,
              $2
            ),

          updated_at =
            NOW()

        WHERE id = $3
        `,

        [

          novaDataISO,

          payment.subscription
            ? String(
                payment.subscription
              )
            : null,

          localId

        ]

      );


      console.log(
        "PAGAMENTO RECEBIDO:",
        localId,
        payment.id || ""
      );

    }


    // ========================================================
    // PAGAMENTO CONFIRMADO
    // ========================================================
    //
    // PAYMENT_CONFIRMED significa que o pagamento foi
    // concluído, mas os fundos ainda não necessariamente
    // estão disponíveis.
    //
    // Para evitar liberar duas vezes, apenas garantimos
    // ACTIVE caso ainda esteja PENDING.
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
          localId
        ]

      );


      console.log(
        "PAGAMENTO CONFIRMADO:",
        localId,
        payment.id || ""
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
            CASE

              WHEN status = 'ACTIVE'
                THEN 'PENDING'

              ELSE status

            END,

          updated_at =
            NOW()

        WHERE id = $1
        `,

        [
          localId
        ]

      );


      console.log(
        "PAGAMENTO VENCIDO:",
        localId
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
            CASE

              WHEN status = 'PENDING'
                THEN 'CANCELLED'

              ELSE status

            END,

          updated_at =
            NOW()

        WHERE id = $1
        `,

        [
          localId
        ]

      );


      console.log(
        "CHECKOUT CANCELADO:",
        localId
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
            CASE

              WHEN status = 'PENDING'
                THEN 'EXPIRED'

              ELSE status

            END,

          updated_at =
            NOW()

        WHERE id = $1
        `,

        [
          localId
        ]

      );


      console.log(
        "CHECKOUT EXPIRADO:",
        localId
      );

    }


    // ========================================================
    // ASSINATURA INATIVADA
    // ========================================================

    if (
      eventType ===
      "SUBSCRIPTION_INACTIVATED"
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
          localId
        ]

      );


      console.log(
        "ASSINATURA INATIVADA:",
        localId
      );

    }


    // ========================================================
    // ASSINATURA DELETADA
    // ========================================================

    if (
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
          localId
        ]

      );


      console.log(
        "ASSINATURA DELETADA:",
        localId
      );

    }


    // ========================================================
    // ESTORNO
    // ========================================================
    //
    // Caso um pagamento seja estornado, não devemos
    // simplesmente manter a assinatura ativa.
    //
    // ========================================================

    if (
      eventType ===
        "PAYMENT_REFUNDED" ||

      eventType ===
        "PAYMENT_CHARGEBACK_REQUESTED"
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
          localId
        ]

      );


      console.log(
        "PAGAMENTO ESTORNADO/CHARGEBACK:",
        localId
      );

    }


    // ========================================================
    // RESPONDER ASAAS
    // ========================================================

    return res.sendStatus(
      200
    );

  } catch (error) {

    console.error(
      "ERRO NO WEBHOOK ASAAS:",
      error
    );


    return res.sendStatus(
      500
    );

  }

}


// ============================================================
// WEBHOOK PRINCIPAL
// ============================================================
//
// Mantemos /webhook para compatibilidade.
//
// ============================================================

router.post(
  "/webhook",
  processarWebhookAsaas
);


// ============================================================
// WEBHOOK ASAAS EXPLÍCITO
// ============================================================
//
// Também disponibilizamos /webhook/asaas.
//
// ============================================================

router.post(
  "/webhook/asaas",
  processarWebhookAsaas
);


// ============================================================
// EXPORTAR
// ============================================================

module.exports =
  router;
