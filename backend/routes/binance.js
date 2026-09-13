const express = require('express');
const crypto = require('crypto');
const https = require('https');

const db = require('../services/db');
const authMiddleware = require('../middleware/auth');
const cryptoService = require('../services/cryptoService');
const Binance = require('binance-api-node').default;

const router = express.Router();


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
// LISTAR CONTAS BINANCE DO USUARIO LOGADO
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
          [req.user.id]
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
// CONSULTAR SALDO DA CONTA BINANCE
// SOMENTE LEITURA
// =========================================================

router.get(
  '/accounts/:id/balance',
  authMiddleware,
  async (req, res) => {

    try {

      const accountId =
        req.params.id;


      // =====================================================
      // BUSCAR CONTA DO USUÁRIO LOGADO
      // =====================================================

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


      const account =
        result.rows[0];


      if (!account.active) {

        return res.status(400).json({

          success: false,

          message:
            'Esta conta Binance está inativa.'

        });

      }


      // =====================================================
      // DESCRIPTOGRAFAR SOMENTE EM MEMÓRIA
      // =====================================================

      const apiKey =
        cryptoService.decrypt(
          account.api_key_encrypted
        );


      const apiSecret =
        cryptoService.decrypt(
          account.api_secret_encrypted
        );


      // =====================================================
      // CONECTAR À BINANCE
      // SOMENTE LEITURA
      // =====================================================

      const client =
        Binance({

          apiKey,

          apiSecret

        });


      const accountInfo =
        await client.accountInfo();


      // =====================================================
      // LOCALIZAR SALDO USDT
      // =====================================================

      const usdtBalance =
        accountInfo.balances.find(
          (asset) =>
            asset.asset === 'USDT'
        );


      const available =
        usdtBalance
          ? parseFloat(
              usdtBalance.free
            )
          : 0;


      const locked =
        usdtBalance
          ? parseFloat(
              usdtBalance.locked
            )
          : 0;


      const total =
        available + locked;


      return res.json({

        success: true,

        account: {

          id:
            account.id,

          name:
            account.name

        },

        balance: {

          asset: 'USDT',

          available,

          locked,

          total

        }

      });


    } catch (error) {

      console.error(
        'ERRO AO CONSULTAR SALDO BINANCE:',
        error
      );


      return res.status(400).json({

        success: false,

        message:
          'Não foi possível consultar o saldo da conta Binance.'

      });

    }

  }
);


// =========================================================
// TESTAR CONEXÃO E PERMISSÕES DA API BINANCE
// =========================================================

router.get(
  '/accounts/:id/test',
  authMiddleware,
  async (req, res) => {

    try {

      const accountId =
        req.params.id;


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


      const account =
        result.rows[0];


      if (!account.active) {

        return res.status(400).json({

          success: false,

          message:
            'Esta conta Binance está inativa.'

        });

      }


      // =====================================================
      // DESCRIPTOGRAFAR SOMENTE EM MEMÓRIA
      // =====================================================

      const apiKey =
        cryptoService.decrypt(
          account.api_key_encrypted
        );


      const apiSecret =
        cryptoService.decrypt(
          account.api_secret_encrypted
        );


      // =====================================================
      // TESTAR AUTENTICAÇÃO
      // SOMENTE LEITURA
      // =====================================================

      const client =
        Binance({

          apiKey,

          apiSecret

        });


      await client.accountInfo();


      // =====================================================
      // CONSULTAR PERMISSÕES REAIS DA API KEY
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
// EXPORTAR ROTAS
// =========================================================

module.exports = router;
