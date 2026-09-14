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


// ============================================================
// CRIAR ROUTER
// ============================================================

const router = express.Router();


// ============================================================
// TESTE DO MERCADO PAGO
// ============================================================

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


// ============================================================
// ROTA DE TESTE DO MERCADO PAGO
// ============================================================

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

    message:
      "Rota de assinatura funcionando."

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

    const userId =
      req.user.id;


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


    const plano =
      PLANOS[planCode];


    // --------------------------------------------------------
    // VERIFICAR USUÁRIO
    // --------------------------------------------------------

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

    if (
      pendingResult.rows.length > 0
    ) {

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

    const result =
      await db.query(

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
    // RESPOSTA
    // --------------------------------------------------------

    return res.status(201).json({

      success: true,

      message:
        "Plano selecionado. A contratação está aguardando pagamento.",

      requiresPayment:
        true,

      subscription: {

        id:
          subscription.id,

        plan:
          subscription.plan,

        planName:
          plano.nome,

        status:
          subscription.status,

        amount:
          subscription.amount,

        simultaneousOperations:
          plano.operacoesSimultaneas,

        binanceAccounts:
          plano.contasBinance,

        paymentProvider:
          subscription.payment_provider,

        paymentMethod:
          subscription.payment_method,

        startedAt:
          subscription.started_at,

        expiresAt:
          subscription.expires_at,

        createdAt:
          subscription.created_at

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

    const userId =
      req.user.id;


    // --------------------------------------------------------
    // BUSCAR ASSINATURA
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // USUÁRIO AINDA NÃO POSSUI ASSINATURA
    // --------------------------------------------------------

    if (
      result.rows.length === 0
    ) {

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

module.exports = router;
