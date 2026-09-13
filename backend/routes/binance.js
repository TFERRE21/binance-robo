const express = require('express');
const crypto = require('crypto');
const https = require('https');

const db = require('../services/db');
const authMiddleware = require('../middleware/auth');
const cryptoService = require('../services/cryptoService');
const Binance = require('binance-api-node').default;

const router = express.Router();


// =========================================================
// FUNÇÕES AUXILIARES
// =========================================================

function num(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}


function assetNormalizado(asset) {
  return String(asset || '')
    .replace(/^LD/, '');
}


// =========================================================
// CONSULTAR PERMISSÕES REAIS DA API KEY BINANCE
// =========================================================

function getApiRestrictions(apiKey, apiSecret) {

  return new Promise((resolve, reject) => {

    const timestamp = Date.now();
    const recvWindow = 5000;

    const params =
      `timestamp=${timestamp}&recvWindow=${recvWindow}`;

    const signature =
      crypto
        .createHmac('sha256', apiSecret)
        .update(params)
        .digest('hex');

    const path =
      `/sapi/v1/account/apiRestrictions?${params}&signature=${signature}`;

    const request =
      https.request(
        {
          hostname: 'api.binance.com',
          path,
          method: 'GET',

          headers: {
            'X-MBX-APIKEY': apiKey
          }
        },

        (response) => {

          let body = '';

          response.on(
            'data',
            (chunk) => {
              body += chunk;
            }
          );

          response.on(
            'end',
            () => {

              try {

                const data =
                  JSON.parse(body);

                if (
                  response.statusCode < 200 ||
                  response.statusCode >= 300
                ) {

                  return reject(
                    new Error(
                      data.msg ||
                      'Erro ao consultar permissões da API Key.'
                    )
                  );

                }

                resolve(data);

              } catch (error) {

                reject(error);

              }

            }
          );

        }
      );


    request.on(
      'error',
      reject
    );


    request.end();

  });

}


// =========================================================
// BUSCAR CONTA DO BANCO
// =========================================================

async function obterContaBanco(
  accountId,
  userId
) {

  const result =
    await db.query(
      `SELECT
         id,
         name,
         api_key_encrypted,
         api_secret_encrypted,
         active
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

function criarClienteBinance(account) {

  const apiKey =
    cryptoService.decrypt(
      account.api_key_encrypted
    );

  const apiSecret =
    cryptoService.decrypt(
      account.api_secret_encrypted
    );


  return {
    apiKey,
    apiSecret,

    client:
      Binance({
        apiKey,
        apiSecret
      })
  };

}


// =========================================================
// LISTAR CONTAS BINANCE DO USUÁRIO
// =========================================================

router.get(
  '/accounts',
  authMiddleware,
  async (req, res) => {

    try {

      const result =
        await db.query(
          `SELECT
             id,
             name,
             active,
             created_at,
             updated_at
           FROM binance_accounts
           WHERE user_id = $1
           ORDER BY id`,
          [
            req.user.id
          ]
        );


      return res.json({

        success: true,

        accounts:
          result.rows

      });


    } catch (error) {

      console.error(
        'ERRO AO LISTAR CONTAS BINANCE:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Erro interno ao listar contas Binance.'

      });

    }

  }
);


// =========================================================
// CADASTRAR CONTA BINANCE
// =========================================================

router.post(
  '/accounts',
  authMiddleware,
  async (req, res) => {

    try {

      const {
        name,
        apiKey,
        apiSecret
      } = req.body;


      if (
        !name ||
        !apiKey ||
        !apiSecret
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Nome, API Key e API Secret são obrigatórios.'

        });

      }


      // =====================================================
      // CRIPTOGRAFAR CREDENCIAIS
      // =====================================================

      const apiKeyEncrypted =
        cryptoService.encrypt(
          apiKey
        );


      const apiSecretEncrypted =
        cryptoService.encrypt(
          apiSecret
        );


      const result =
        await db.query(
          `INSERT INTO binance_accounts
           (
             user_id,
             name,
             api_key_encrypted,
             api_secret_encrypted,
             active
           )
           VALUES ($1, $2, $3, $4, true)
           RETURNING
             id,
             name,
             active,
             created_at,
             updated_at`,
          [
            req.user.id,
            name,
            apiKeyEncrypted,
            apiSecretEncrypted
          ]
        );


      return res.status(201).json({

        success: true,

        message:
          'Conta Binance cadastrada com sucesso.',

        account:
          result.rows[0]

      });


    } catch (error) {

      console.error(
        'ERRO AO CADASTRAR CONTA BINANCE:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Erro interno ao cadastrar conta Binance.'

      });

    }

  }
);


// =========================================================
// CONSULTAR SALDO / PATRIMÔNIO COMPLETO
// =========================================================
//
// Calcula o patrimônio da mesma forma que o painel antigo:
//
// 1. Busca todos os balances.
// 2. Soma FREE + LOCKED.
// 3. Converte cada ativo para USDT.
// 4. Soma todos os ativos.
// 5. Separa disponível e bloqueado.
// =========================================================

router.get(
  '/accounts/:id/balance',
  authMiddleware,
  async (req, res) => {

    try {

      const accountId =
        req.params.id;


      // =====================================================
      // BUSCAR CONTA
      // =====================================================

      const account =
        await obterContaBanco(
          accountId,
          req.user.id
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


      // =====================================================
      // CLIENT BINANCE
      // =====================================================

      const {
        client
      } =
        criarClienteBinance(
          account
        );


      // =====================================================
      // BUSCAR DADOS DA BINANCE
      // =====================================================

      const resultado =
        await Promise.all([
          client.accountInfo(),
          client.prices()
        ]);


      const info =
        resultado[0];

      const prices =
        resultado[1];


      // =====================================================
      // CALCULAR PATRIMÔNIO
      // =====================================================

      const ativos = [];

      let patrimonioUSDT = 0;

      let disponivelUSDT = 0;

      let bloqueadoUSDT = 0;


      for (
        const balance
        of info.balances || []
      ) {

        const free =
          num(
            balance.free
          );


        const locked =
          num(
            balance.locked
          );


        const total =
          free + locked;


        if (
          total <= 0
        ) {

          continue;

        }


        const asset =
          assetNormalizado(
            balance.asset
          );


        let precoUSDT = 0;

        let valorUSDT = 0;

        let valorFreeUSDT = 0;

        let valorLockedUSDT = 0;


        // ===================================================
        // USDT
        // ===================================================

        if (
          asset === 'USDT'
        ) {

          precoUSDT = 1;

        }


        // ===================================================
        // OUTROS ATIVOS
        // ===================================================

        else {

          precoUSDT =
            num(
              prices[
                asset + 'USDT'
              ] ||
              prices[
                'LD' +
                asset +
                'USDT'
              ]
            );


          // =================================================
          // CASO NÃO EXISTA PAR DIRETO ASSET/USDT
          // TENTA O CAMINHO ASSET/BNB + BNB/USDT
          // =================================================

          if (
            precoUSDT <= 0
          ) {

            const assetBNB =
              num(
                prices[
                  asset + 'BNB'
                ] ||
                prices[
                  'LD' +
                  asset +
                  'BNB'
                ]
              );


            const bnbUSDT =
              num(
                prices.BNBUSDT
              );


            if (
              assetBNB > 0 &&
              bnbUSDT > 0
            ) {

              precoUSDT =
                assetBNB *
                bnbUSDT;

            }

          }


          // =================================================
          // CASO NÃO EXISTA BNB
          // TENTA ASSET/BTC + BTC/USDT
          // =================================================

          if (
            precoUSDT <= 0
          ) {

            const assetBTC =
              num(
                prices[
                  asset + 'BTC'
                ] ||
                prices[
                  'LD' +
                  asset +
                  'BTC'
                ]
              );


            const btcUSDT =
              num(
                prices.BTCUSDT
              );


            if (
              assetBTC > 0 &&
              btcUSDT > 0
            ) {

              precoUSDT =
                assetBTC *
                btcUSDT;

            }

          }

        }


        // ===================================================
        // CALCULAR VALORES
        // ===================================================

        if (
          precoUSDT > 0
        ) {

          valorUSDT =
            total *
            precoUSDT;


          valorFreeUSDT =
            free *
            precoUSDT;


          valorLockedUSDT =
            locked *
            precoUSDT;

        }


        // ===================================================
        // SOMAR PATRIMÔNIO
        // ===================================================

        if (
          valorUSDT > 0
        ) {

          patrimonioUSDT +=
            valorUSDT;

          disponivelUSDT +=
            valorFreeUSDT;

          bloqueadoUSDT +=
            valorLockedUSDT;


          // =================================================
          // GUARDAR ATIVO
          // =================================================

          if (
            valorUSDT > 0.01
          ) {

            ativos.push({

              asset,

              free,

              locked,

              total,

              precoUSDT,

              valorUSDT,

              valorFreeUSDT,

              valorLockedUSDT

            });

          }

        }

      }


      // =====================================================
      // ORDENAR ATIVOS POR VALOR
      // =====================================================

      ativos.sort(
        (a, b) =>
          b.valorUSDT -
          a.valorUSDT
      );


      // =====================================================
      // RETORNO
      // =====================================================

      return res.json({

        success: true,

        account: {

          id:
            account.id,

          name:
            account.name

        },

        balance: {

          asset:
            'USDT',

          total:
            patrimonioUSDT,

          available:
            disponivelUSDT,

          locked:
            bloqueadoUSDT,

          totalAssets:
            ativos.length,

          assets:
            ativos

        }

      });


    } catch (error) {

      console.error(
        'ERRO AO CONSULTAR SALDO/PATRIMÔNIO BINANCE:',
        error
      );


      return res.status(400).json({

        success: false,

        message:
          'Não foi possível consultar o patrimônio da conta Binance.'

      });

    }

  }
);


// =========================================================
// TESTAR CONEXÃO E PERMISSÕES
// =========================================================

router.get(
  '/accounts/:id/test',
  authMiddleware,
  async (req, res) => {

    try {

      const accountId =
        req.params.id;


      const account =
        await obterContaBanco(
          accountId,
          req.user.id
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


      // =====================================================
      // CREDENCIAIS SOMENTE EM MEMÓRIA
      // =====================================================

      const {
        apiKey,
        apiSecret,
        client
      } =
        criarClienteBinance(
          account
        );


      // =====================================================
      // TESTAR AUTENTICAÇÃO
      // SOMENTE LEITURA
      // =====================================================

      await client.accountInfo();


      // =====================================================
      // CONSULTAR PERMISSÕES REAIS
      // =====================================================

      const permissions =
        await getApiRestrictions(
          apiKey,
          apiSecret
        );


      return res.json({

        success: true,

        connected: true,

        message:
          'Conexão e permissões da API verificadas com sucesso.',

        account: {

          id:
            account.id,

          name:
            account.name

        },

        permissions: {

          reading:
            permissions.enableReading === true,

          withdrawals:
            permissions.enableWithdrawals === true,

          spotAndMarginTrading:
            permissions.enableSpotAndMarginTrading === true,

          futures:
            permissions.enableFutures === true,

          margin:
            permissions.enableMargin === true,

          internalTransfer:
            permissions.enableInternalTransfer === true,

          ipRestricted:
            permissions.ipRestrict === true

        }

      });


    } catch (error) {

      console.error(
        'ERRO AO TESTAR CONEXÃO/PERMISSÕES BINANCE:',
        error
      );


      return res.status(400).json({

        success: false,

        connected: false,

        message:
          'Não foi possível verificar a API Binance. Verifique as credenciais e as permissões da API.'

      });

    }

  }
);


// =========================================================
// EXCLUIR CONTA BINANCE
// =========================================================

router.delete(
  '/accounts/:id',
  authMiddleware,
  async (req, res) => {

    try {

      const accountId =
        req.params.id;


      const result =
        await db.query(
          `DELETE FROM binance_accounts
           WHERE id = $1
           AND user_id = $2
           RETURNING id, name`,
          [
            accountId,
            req.user.id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          message:
            'Conta Binance não encontrada.'

        });

      }


      return res.json({

        success: true,

        message:
          'Conta Binance excluída com sucesso.',

        account:
          result.rows[0]

      });


    } catch (error) {

      console.error(
        'ERRO AO EXCLUIR CONTA BINANCE:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Erro interno ao excluir conta Binance.'

      });

    }

  }
);


// =========================================================
// EXPORTAR
// =========================================================

module.exports = router;
