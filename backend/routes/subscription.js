const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

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
        message: "Nenhuma assinatura encontrada."
      });

    }


    const subscription = result.rows[0];


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

      const agora = new Date();

      const vencimento =
        new Date(subscription.expires_at);


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
          [subscription.id]
        );


        subscription.status =
          "EXPIRED";

      }

    }


    // --------------------------------------------------------
    // INFORMAÇÕES DO PLANO
    // --------------------------------------------------------

    const plano =
      PLANOS[subscription.plan] || null;


    // --------------------------------------------------------
    // RESPOSTA
    // --------------------------------------------------------

    return res.json({

      success: true,

      hasSubscription: true,

      active: active,

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
// EXPORTAR
// ============================================================

module.exports = router;
