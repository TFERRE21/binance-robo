const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const {
  MercadoPagoConfig,
  PreApproval
} = require("mercadopago");


// ============================================================
// CONFIGURAÇÃO DO MERCADO PAGO
// ============================================================

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
});

const preApprovalClient = new PreApproval(mpClient);

const router = express.Router();


// ============================================================
// CRIAR ASSINATURA NO MERCADO PAGO
// ============================================================

async function criarAssinaturaMercadoPago({
  email,
  plano,
  valor,
  subscriptionId
}) {

  const baseUrl =
    "https://site--painel-binance--clbfrw28wczh.code.run";

  const resultado =
    await preApprovalClient.create({

      body: {

        reason:
          `CriptoPro - Plano ${plano}`,

        // Sem plano associado: o cliente conclui a assinatura no checkout.

        external_reference:
          String(subscriptionId),

        payer_email:
          email,

        auto_recurring: {

          frequency:
            1,

          frequency_type:
            "months",

          transaction_amount:
            Number(valor),

          currency_id:
            "BRL"

        },

        back_url:
          "https://www.google.com",

        status:
          "pending"

      }

    });

  return resultado;
}


async function testarMercadoPago() {

  try {

    const resultado =
      await preApprovalClient.search({
        options: {
          limit: 1
        }
      });

    return {
      success: true,
      total: resultado.total ?? 0
    };

  } catch (error) {

    console.error(
      "ERRO AO TESTAR MERCADO PAGO:",
      error
    );

    return {
      success: false,
      message: error.message
    };

  }

}


router.get("/teste-mercadopago", async (req, res) => {

  const resultado =
    await testarMercadoPago();

  return res.json(resultado);

});

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
// TESTE DA ROTA
// ============================================================

router.get("/teste", (req, res) => {

  return res.json({
    success: true,
    message: "Rota de assinatura funcionando."
  });

});


// ============================================================
// BUSCAR PLANOS DISPONÍVEIS
// ============================================================

router.get("/plans", (req, res) => {

  return res.json({

    success: true,

    plans: Object.entries(PLANOS).map(
      ([codigo, plano]) => ({

        code: codigo,

        name: plano.nome,

        price: plano.valor,

        simultaneousOperations:
          plano.operacoesSimultaneas,

        binanceAccounts:
          plano.contasBinance

      })
    )

  });

});


// ============================================================
// SELECIONAR PLANO
// ============================================================
//
// IMPORTANTE:
//
// Selecionar um plano NÃO libera o painel.
//
// A assinatura é criada como PENDING.
//
// Somente depois da confirmação do pagamento
// ela deverá ser alterada para ACTIVE.
//
// ============================================================

router.post("/select", authMiddleware, async (req, res) => {

  try {

    const userId = req.user.id;

    const planCode =
      String(
        req.body && req.body.plan
          ? req.body.plan
          : ""
      )
      .trim()
      .toLowerCase();


    // --------------------------------------------------------
    // VALIDAR PLANO
    // --------------------------------------------------------

    if (!PLANOS[planCode]) {

      return res.status(400).json({

        success: false,

        message:
          "Plano inválido. Escolha Básico, Profissional ou Premium."

      });

    }


    const plano = PLANOS[planCode];


    // --------------------------------------------------------
    // VERIFICAR USUÁRIO
    // --------------------------------------------------------

    const userResult = await db.query(

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


    if (userResult.rows.length === 0) {

      return res.status(404).json({

        success: false,

        message:
          "Usuário não encontrado."

      });

    }


    const user = userResult.rows[0];


    if (!user.active) {

      return res.status(403).json({

        success: false,

        message:
          "Usuário inativo."

      });

    }


    // --------------------------------------------------------
    // VERIFICAR ASSINATURA ATIVA
    // --------------------------------------------------------

    const activeResult = await db.query(

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


    if (activeResult.rows.length > 0) {

      const activeSubscription =
        activeResult.rows[0];


      // ------------------------------------------------------
      // JÁ POSSUI O MESMO PLANO ATIVO
      // ------------------------------------------------------

      if (
        activeSubscription.plan === planCode
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


      // ------------------------------------------------------
      // POSSUI OUTRO PLANO ATIVO
      // ------------------------------------------------------

      return res.status(409).json({

        success: false,

        message:
          "Você já possui uma assinatura ativa. O novo plano poderá ser contratado após o tratamento da assinatura atual.",

        currentPlan:
          activeSubscription.plan

      });

    }


    // --------------------------------------------------------
    // VERIFICAR PAGAMENTO PENDENTE RECENTE
    // --------------------------------------------------------
    //
    // Evita criar várias assinaturas PENDING iguais
    // toda vez que o usuário clicar no botão.
    //
    // --------------------------------------------------------

    const pendingResult = await db.query(

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
      ORDER BY created_at DESC
      LIMIT 1
      `,

      [
        userId,
        planCode
      ]

    );


    // --------------------------------------------------------
    // JÁ EXISTE PENDING
    // --------------------------------------------------------

    if (pendingResult.rows.length > 0) {

      const pending =
        pendingResult.rows[0];


      return res.json({

        success: true,

        message:
          "Existe uma contratação pendente para este plano.",

        requiresPayment:
          true,

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


    // --------------------------------------------------------
    // CRIAR NOVA ASSINATURA PENDING
    // --------------------------------------------------------

    const result = await db.query(

      `
      INSERT INTO subscriptions (

        user_id,

        plan,

        status,

        amount

      )

      VALUES (

        $1,

        $2,

        'PENDING',

        $3

      )

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
        userId,
        planCode,
        plano.valor
      ]

    );


    const subscription =
      result.rows[0];


    // --------------------------------------------------------
    // CRIAR ASSINATURA NO MERCADO PAGO
    // --------------------------------------------------------

    let mercadoPagoSubscription;

    try {

      mercadoPagoSubscription =
        await criarAssinaturaMercadoPago({

          email:
            user.email,

          plano:
            plano.nome,

          valor:
            plano.valor,

          subscriptionId:
            subscription.id

        });

    } catch (mercadoPagoError) {

      console.error(
        "ERRO AO CRIAR ASSINATURA NO MERCADO PAGO:",
        mercadoPagoError
      );


      await db.query(

        `
        DELETE FROM subscriptions
        WHERE id = $1
        `,

        [subscription.id]

      );


      return res.status(502).json({

        success: false,

        message:
          "Não foi possível iniciar a contratação no Mercado Pago."

      });

    }


    // --------------------------------------------------------
    // SALVAR ID DA ASSINATURA DO MERCADO PAGO
    // --------------------------------------------------------

    const mercadoPagoId =
      mercadoPagoSubscription.id
        ? String(mercadoPagoSubscription.id)
        : null;


    if (!mercadoPagoId) {

      console.error(
        "MERCADO PAGO NÃO RETORNOU ID DE ASSINATURA:",
        mercadoPagoSubscription
      );


      await db.query(

        `
        DELETE FROM subscriptions
        WHERE id = $1
        `,

        [subscription.id]

      );


      return res.status(502).json({

        success: false,

        message:
          "O Mercado Pago não retornou o identificador da assinatura."

      });

    }


    const updatedSubscription =
      await db.query(

        `
        UPDATE subscriptions

        SET

          payment_provider =
            'MERCADO_PAGO',

          external_subscription_id =
            $1,

          payment_method =
            'MERCADO_PAGO',

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
          mercadoPagoId,
          subscription.id
        ]

      );


    const subscriptionAtualizada =
      updatedSubscription.rows[0];


    // --------------------------------------------------------
    // LINK DE PAGAMENTO
    // --------------------------------------------------------

    const paymentUrl =
      mercadoPagoSubscription.init_point ||
      mercadoPagoSubscription.sandbox_init_point ||
      null;


    if (!paymentUrl) {

      console.error(
        "MERCADO PAGO NÃO RETORNOU LINK DE PAGAMENTO:",
        mercadoPagoSubscription
      );


      return res.status(502).json({

        success: false,

        message:
          "A assinatura foi criada, mas o Mercado Pago não retornou o link de pagamento."

      });

    }


    // --------------------------------------------------------
    // RESPOSTA
    // --------------------------------------------------------

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

});


// ============================================================
// STATUS DA ASSINATURA DO USUÁRIO
// ============================================================

router.get("/status", authMiddleware, async (req, res) => {

  try {

    const userId = req.user.id;


    // --------------------------------------------------------
    // BUSCAR ASSINATURA
    // --------------------------------------------------------

    const result = await db.query(

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


    // --------------------------------------------------------
    // USUÁRIO AINDA NÃO POSSUI ASSINATURA
    // --------------------------------------------------------

    if (result.rows.length === 0) {

      return res.json({

        success: true,

        hasSubscription: false,

        active: false,

        plan: null,

        planName: null,

        status: null,

        amount: null,

        paymentMethod: null,

        expiresAt: null,

        message:
          "Nenhuma assinatura encontrada."

      });

    }


    const subscription =
      result.rows[0];


    // --------------------------------------------------------
    // VERIFICAR SE ESTÁ ATIVA
    // --------------------------------------------------------

    let active =
      subscription.status === "ACTIVE";


    // --------------------------------------------------------
    // VERIFICAR DATA DE VENCIMENTO
    // --------------------------------------------------------

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

        active = false;


        // ----------------------------------------------------
        // MARCAR COMO EXPIRADA
        // ----------------------------------------------------

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


    // --------------------------------------------------------
    // INFORMAÇÕES DO PLANO
    // --------------------------------------------------------

    const plano =
      PLANOS[
        subscription.plan
      ] || null;


    // --------------------------------------------------------
    // RESPOSTA
    // --------------------------------------------------------

    return res.json({

      success: true,

      hasSubscription: true,

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

});


// ============================================================
// EXPORTAR
// ============================================================


// ============================================================
// WEBHOOK MERCADO PAGO
// ============================================================
// Recebe notificacoes do Mercado Pago.
// A confirmacao definitiva do pagamento sera implementada aqui.
// ============================================================
router.post("/webhook", async (req, res) => {
  try {
    console.log("WEBHOOK MERCADO PAGO RECEBIDO:", JSON.stringify(req.body));
    return res.sendStatus(200);
  } catch (error) {
    console.error("ERRO NO WEBHOOK MERCADO PAGO:", error);
    return res.sendStatus(500);
  }
});

module.exports = router;
