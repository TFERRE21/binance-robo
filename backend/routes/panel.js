const express = require('express');

const db = require('../services/db');
const authMiddleware = require('../middleware/auth');
const cryptoService = require('../services/cryptoService');

const Binance = require('binance-api-node').default;

const router = express.Router();


// =========================================================
// OBTER CONTA BINANCE DO USUÁRIO LOGADO
// =========================================================

async function obterContaUsuario(
  userId,
  accountId
) {

  const result =
    await db.query(
      `SELECT
         id,
         user_id,
         name,
         api_key_encrypted,
         api_secret_encrypted,
         active,
         created_at,
         updated_at
       FROM binance_accounts
       WHERE id = $1
       AND user_id = $2`,
      [
        accountId,
        userId
      ]
    );


  if (
    result.rows.length === 0
  ) {

    return null;

  }


  return result.rows[0];

}


// =========================================================
// CRIAR CLIENT BINANCE
// =========================================================

function criarCliente(account) {

  const apiKey =
    cryptoService.decrypt(
      account.api_key_encrypted
    );


  const apiSecret =
    cryptoService.decrypt(
      account.api_secret_encrypted
    );


  const client =
    Binance({
      apiKey,
      apiSecret
    });


  return {
    client,
    apiKey,
    apiSecret
  };

}


// =========================================================
// PAINEL — DADOS DA CONTA
// =========================================================

router.get(
  '/account/:id',
  authMiddleware,
  async (req, res) => {

    try {

      const accountId =
        req.params.id;


      // ===================================================
      // GARANTIR QUE A CONTA PERTENCE AO USUÁRIO
      // ===================================================

      const account =
        await obterContaUsuario(
          req.user.id,
          accountId
        );


      if (!account) {

        return res.status(404).json({

          success: false,

          message:
            'Conta Binance não encontrada para este usuário.'

        });

      }


      if (!account.active) {

        return res.status(400).json({

          success: false,

          message:
            'Esta conta Binance está inativa.'

        });

      }


      // ===================================================
      // CLIENT BINANCE
      // ===================================================

      const {
        client
      } =
        criarCliente(
          account
        );


      // ===================================================
      // DADOS DA CONTA
      // ===================================================

      const info =
        await client.accountInfo();


      // ===================================================
      // PREÇOS
      // ===================================================

      const prices =
        await client.prices();


      // ===================================================
      // CALCULAR PATRIMÔNIO
      // ===================================================

      let patrimonioUSDT = 0;

      let disponivelUSDT = 0;

      let bloqueadoUSDT = 0;

      const ativos = [];


      for (
        const balance
        of info.balances || []
      ) {

        const free =
          Number(balance.free) || 0;


        const locked =
          Number(balance.locked) || 0;


        const total =
          free + locked;


        if (
          total <= 0
        ) {

          continue;

        }


        const asset =
          String(
            balance.asset || ''
          ).replace(
            /^LD/,
            ''
          );


        let precoUSDT = 0;


        // =================================================
        // USDT
        // =================================================

        if (
          asset === 'USDT'
        ) {

          precoUSDT = 1;

        }


        // =================================================
        // OUTROS ATIVOS
        // =================================================

        else {

          precoUSDT =
            Number(
              prices[
                asset + 'USDT'
              ] || 0
            );

        }


        if (
          precoUSDT <= 0
        ) {

          continue;

        }


        const valorTotal =
          total *
          precoUSDT;


        const valorFree =
          free *
          precoUSDT;


        const valorLocked =
          locked *
          precoUSDT;


        patrimonioUSDT +=
          valorTotal;


        disponivelUSDT +=
          valorFree;


        bloqueadoUSDT +=
          valorLocked;


        if (
          valorTotal > 0.01
        ) {

          ativos.push({

            asset,

            free,

            locked,

            total,

            precoUSDT,

            valorUSDT:
              valorTotal

          });

        }

      }


      // ===================================================
      // ORDENAR ATIVOS
      // ===================================================

      ativos.sort(
        (a, b) =>
          b.valorUSDT -
          a.valorUSDT
      );


      // ===================================================
      // RETORNO
      // ===================================================

      return res.json({

        success: true,

        account: {

          id:
            account.id,

          name:
            account.name,

          active:
            account.active

        },

        summary: {

          patrimonioUSDT,

          disponivelUSDT,

          bloqueadoUSDT,

          totalAtivos:
            ativos.length

        },

        ativos

      });


    } catch (error) {

      console.error(
        'ERRO AO CARREGAR PAINEL:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Não foi possível carregar os dados do painel.'

      });

    }

  }
);


// =========================================================
// PAINEL — GRÁFICO
// =========================================================

router.get(
  '/chart',
  authMiddleware,
  async (req, res) => {

    try {

      const accountId =
        String(
          req.query.account || ''
        );


      const symbol =
        String(
          req.query.symbol ||
          'BTCUSDT'
        ).toUpperCase();


      const interval =
        String(
          req.query.interval ||
          '15m'
        );


      const account =
        await obterContaUsuario(
          req.user.id,
          accountId
        );


      if (!account) {

        return res.status(404).json({

          success: false,

          message:
            'Conta Binance não encontrada.'

        });

      }


      if (!account.active) {

        return res.status(400).json({

          success: false,

          message:
            'Esta conta Binance está inativa.'

        });

      }


      const {
        client
      } =
        criarCliente(
          account
        );


      // ===================================================
      // CANDLES
      // ===================================================

      const candles =
        await client.candles({

          symbol,

          interval,

          limit: 300

        });


      return res.json({

        success: true,

        symbol,

        interval,

        candles:
          candles.map(
            (candle) => ({

              time:
                Math.floor(
                  Number(
                    candle.openTime
                  ) / 1000
                ),

              open:
                Number(
                  candle.open
                ),

              high:
                Number(
                  candle.high
                ),

              low:
                Number(
                  candle.low
                ),

              close:
                Number(
                  candle.close
                )

            })
          )

      });


    } catch (error) {

      console.error(
        'ERRO AO CARREGAR GRÁFICO:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Não foi possível carregar o gráfico.'

      });

    }

  }
);


// =========================================================
// STATUS DO PAINEL
// =========================================================

router.get(
  '/status/:id',
  authMiddleware,
  async (req, res) => {

    try {

      const account =
        await obterContaUsuario(
          req.user.id,
          req.params.id
        );


      if (!account) {

        return res.status(404).json({

          success: false,

          message:
            'Conta Binance não encontrada.'

        });

      }


      return res.json({

        success: true,

        connected:
          account.active === true,

        account: {

          id:
            account.id,

          name:
            account.name,

          active:
            account.active

        }

      });


    } catch (error) {

      console.error(
        'ERRO AO CONSULTAR STATUS DO PAINEL:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Erro ao consultar status da conta.'

      });

    }

  }
);


module.exports = router;
