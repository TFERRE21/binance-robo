const express = require('express');
const crypto = require('crypto');
const https = require('https');

const db = require('../services/db');
const authMiddleware = require('../middleware/auth');
const cryptoService = require('../services/cryptoService');
const Binance = require('binance-api-node').default;

const router = express.Router();

/*
 * =========================================================
 * BINANCE - FUNÇÃO PARA CONSULTAR ENDPOINT ASSINADO
 * =========================================================
 *
 * Usada para consultar as permissões reais da API Key.
 */

function binanceSignedPost(path, apiKey, apiSecret, params = {}) {
  return new Promise((resolve, reject) => {
    const bodyParams = {
      ...params,
      timestamp: Date.now().toString(),
      recvWindow: '10000'
    };

    const body = new URLSearchParams(bodyParams).toString();

    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(body)
      .digest('hex');

    const request = https.request(
      {
        hostname: 'api.binance.com',
        path,
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body + '&signature=' + signature)
        },
        timeout: 15000
      },
      (response) => {
        let responseBody = '';

        response.on('data', (chunk) => {
          responseBody += chunk;
        });

        response.on('end', () => {
          let data;

          try {
            data = JSON.parse(responseBody);
          } catch {
            data = {
              code: response.statusCode,
              msg: responseBody
            };
          }

          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(data);
          } else {
            const error = new Error(
              data?.msg || `Binance HTTP ${response.statusCode}`
            );

            error.binanceCode = data?.code;
            error.statusCode = response.statusCode;

            reject(error);
          }
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(
        new Error('Tempo esgotado ao conectar à Binance.')
      );
    });

    request.on('error', reject);

    request.write(body + '&signature=' + signature);
    request.end();
  });
}


function binanceSignedGet(path, apiKey, apiSecret, params = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      ...params,
      timestamp: Date.now().toString(),
      recvWindow: '10000'
    }).toString();

    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(query)
      .digest('hex');

    const url = `${path}?${query}&signature=${signature}`;

    const request = https.request(
      {
        hostname: 'api.binance.com',
        path: url,
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': apiKey
        },
        timeout: 15000
      },
      (response) => {
        let body = '';

        response.on('data', (chunk) => {
          body += chunk;
        });

        response.on('end', () => {
          let data;

          try {
            data = JSON.parse(body);
          } catch {
            data = {
              code: response.statusCode,
              msg: body
            };
          }

          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(data);
          } else {
            const error = new Error(
              data?.msg || `Binance HTTP ${response.statusCode}`
            );

            error.binanceCode = data?.code;
            error.statusCode = response.statusCode;

            reject(error);
          }
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(
        new Error('Tempo esgotado ao conectar à Binance.')
      );
    });

    request.on('error', reject);

    request.end();
  });
}


/*
 * =========================================================
 * LISTAR CONTAS BINANCE DO USUÁRIO
 * =========================================================
 */

router.get('/accounts', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
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
      accounts: result.rows
    });

  } catch (error) {
    console.error(
      'ERRO AO LISTAR CONTAS BINANCE:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao listar contas Binance.'
    });
  }
});


/*
 * =========================================================
 * TESTAR CREDENCIAIS ANTES DE SALVAR
 * =========================================================
 *
 * POST
 * /api/binance/test-credentials
 *
 * Recebe:
 * {
 *   apiKey,
 *   apiSecret
 * }
 *
 * Não grava as credenciais no banco.
 */

router.post(
  '/test-credentials',
  authMiddleware,
  async (req, res) => {

    try {

      const {
        apiKey,
        apiSecret
      } = req.body;


      /*
       * Validação inicial
       */

      if (!apiKey || !apiSecret) {

        return res.status(400).json({
          success: false,
          connected: false,
          message:
            'API Key e API Secret são obrigatórios.'
        });

      }


      /*
       * Remove espaços acidentais
       */

      const cleanApiKey =
        String(apiKey).trim();

      const cleanApiSecret =
        String(apiSecret).trim();


      if (!cleanApiKey || !cleanApiSecret) {

        return res.status(400).json({
          success: false,
          connected: false,
          message:
            'API Key e API Secret não podem estar vazias.'
        });

      }


      /*
       * =====================================================
       * 1. TESTE DE AUTENTICAÇÃO NA BINANCE
       * =====================================================
       */

      const client = Binance({
        apiKey: cleanApiKey,
        apiSecret: cleanApiSecret
      });


      const accountInfo =
        await client.accountInfo();


      /*
       * =====================================================
       * 2. CONSULTAR PERMISSÕES REAIS
       * =====================================================
       */

      let restrictions;

      try {

        restrictions =
          await binanceSignedGet(
            '/sapi/v1/account/apiRestrictions',
            cleanApiKey,
            cleanApiSecret
          );

      } catch (permissionError) {

        console.error(
          'ERRO AO CONSULTAR PERMISSÕES DA API BINANCE:',
          permissionError
        );

        return res.status(400).json({

          success: false,

          connected: false,

          message:
            'A API foi autenticada, mas não foi possível consultar as permissões da chave na Binance.',

          binanceCode:
            permissionError.binanceCode || null

        });

      }


      /*
       * =====================================================
       * 3. INTERPRETAÇÃO DIRETA DAS PERMISSÕES
       * =====================================================
       *
       * IMPORTANTE:
       *
       * true  = ATIVADO
       * false = DESATIVADO
       * undefined = DESCONHECIDO
       *
       * Não transformamos undefined em true.
       */

      const canRead =
        restrictions.enableReading === true;

      const canTrade =
        restrictions.enableSpotAndMarginTrading === true;

      const canWithdraw =
        restrictions.enableWithdrawals === true;

      const canDeposit =
        restrictions.enableInternalTransfer === true;


      /*
       * =====================================================
       * 4. RETORNO PARA O FRONTEND
       * =====================================================
       */

      return res.json({

        success: true,

        connected: true,

        message:
          'Conexão com a Binance realizada com sucesso.',


        /*
         * Permissões já interpretadas
         */

        permissions: {

          canRead,

          canTrade,

          canWithdraw,

          canDeposit

        },


        /*
         * Dados de segurança
         */

        security: {

          withdrawalsDisabled:
            restrictions.enableWithdrawals === false

        },


        /*
         * Dados reais retornados pela Binance.
         *
         * Não contém API Key nem Secret.
         */

        binancePermissions: {

          enableReading:
            restrictions.enableReading,

          enableSpotAndMarginTrading:
            restrictions.enableSpotAndMarginTrading,

          enableWithdrawals:
            restrictions.enableWithdrawals,

          enableInternalTransfer:
            restrictions.enableInternalTransfer,

          enableFutures:
            restrictions.enableFutures,

          enableVanillaOptions:
            restrictions.enableVanillaOptions,

          enablePortfolioMarginTrading:
            restrictions.enablePortfolioMarginTrading

        },


        /*
         * Informações adicionais da conta.
         */

        account: {

          canTrade:
            accountInfo.canTrade,

          canWithdraw:
            accountInfo.canWithdraw,

          canDeposit:
            accountInfo.canDeposit

        }

      });

    } catch (error) {

      console.error(
        'ERRO AO TESTAR CREDENCIAIS BINANCE:',
        error
      );


      let message =
        'Não foi possível conectar à Binance. Verifique a API Key, API Secret e as permissões da chave.';


      /*
       * Erros conhecidos da Binance
       */

      if (
        error?.code === -2015 ||
        error?.binanceCode === -2015
      ) {

        message =
          'API Key inválida, Secret inválido ou IP não autorizado pela Binance.';

      }


      else if (
        error?.code === -1021 ||
        error?.binanceCode === -1021
      ) {

        message =
          'O horário do servidor está fora da sincronização exigida pela Binance. Tente novamente.';

      }


      else if (
        error?.code === -2014 ||
        error?.binanceCode === -2014
      ) {

        message =
          'API Key inválida ou não encontrada.';

      }


      else if (error?.message) {

        message = error.message;

      }


      return res.status(400).json({

        success: false,

        connected: false,

        message,

        binanceCode:
          error?.code ||
          error?.binanceCode ||
          null

      });

    }

  }
);


/*
 * =========================================================
 * CADASTRAR CONTA BINANCE
 * =========================================================
 *
 * As credenciais são criptografadas antes de serem
 * armazenadas no banco.
 */

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


      if (!name || !apiKey || !apiSecret) {

        return res.status(400).json({

          success: false,

          message:
            'Nome, API Key e API Secret são obrigatórios.'

        });

      }


      /*
       * Criptografar credenciais
       */

      const apiKeyEncrypted =
        cryptoService.encrypt(apiKey);

      const apiSecretEncrypted =
        cryptoService.encrypt(apiSecret);


      /*
       * Salvar no banco
       */

      const result = await db.query(

        `INSERT INTO binance_accounts
         (
           user_id,
           name,
           api_key_encrypted,
           api_secret_encrypted,
           active
         )
         VALUES
         (
           $1,
           $2,
           $3,
           $4,
           true
         )
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


/*
 * =========================================================
 * TESTAR CONTA BINANCE JÁ SALVA
 * =========================================================
 *
 * GET
 * /api/binance/accounts/:id/test
 */

router.get(
  '/accounts/:id/test',
  authMiddleware,
  async (req, res) => {

    try {

      const accountId =
        req.params.id;


      /*
       * Buscar conta pertencente ao usuário
       */

      const result = await db.query(

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


      if (result.rows.length === 0) {

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


      /*
       * Descriptografar credenciais
       */

      const apiKey =
        cryptoService.decrypt(
          account.api_key_encrypted
        );

      const apiSecret =
        cryptoService.decrypt(
          account.api_secret_encrypted
        );


      /*
       * Criar cliente Binance
       */

      const client = Binance({

        apiKey,

        apiSecret

      });


      /*
       * Testar autenticação
       */

      const accountInfo =
        await client.accountInfo();


      /*
       * Consultar permissões
       */

      let restrictions = null;

      try {

        restrictions =
          await binanceSignedGet(

            '/sapi/v1/account/apiRestrictions',

            apiKey,

            apiSecret

          );

      } catch (permissionError) {

        console.error(

          'ERRO AO CONSULTAR PERMISSÕES DA CONTA SALVA:',

          permissionError

        );

      }


      /*
       * Interpretar permissões
       */

      const canRead =
        restrictions
          ? restrictions.enableReading === true
          : false;


      const canTrade =
        restrictions
          ? restrictions.enableSpotAndMarginTrading === true
          : false;


      const canWithdraw =
        restrictions
          ? restrictions.enableWithdrawals === true
          : false;


      const canDeposit =
        restrictions
          ? restrictions.enableInternalTransfer === true
          : false;


      return res.json({

        success: true,

        connected: true,

        message:
          'Conexão com a Binance realizada com sucesso.',


        account: {

          id:
            account.id,

          name:
            account.name

        },


        permissions: {

          canRead,

          canTrade,

          canWithdraw,

          canDeposit

        },


        security: {

          withdrawalsDisabled:
            restrictions
              ? restrictions.enableWithdrawals === false
              : true

        },


        binancePermissions:

          restrictions
            ? {

                enableReading:
                  restrictions.enableReading,

                enableSpotAndMarginTrading:
                  restrictions.enableSpotAndMarginTrading,

                enableWithdrawals:
                  restrictions.enableWithdrawals,

                enableInternalTransfer:
                  restrictions.enableInternalTransfer,

                enableFutures:
                  restrictions.enableFutures,

                enableVanillaOptions:
                  restrictions.enableVanillaOptions,

                enablePortfolioMarginTrading:
                  restrictions.enablePortfolioMarginTrading

              }
            : null,


        accountPermissions: {

          canTrade:
            accountInfo.canTrade,

          canWithdraw:
            accountInfo.canWithdraw,

          canDeposit:
            accountInfo.canDeposit

        }

      });

    } catch (error) {

      console.error(
        'ERRO AO TESTAR CONEXÃO BINANCE:',
        error
      );


      let message =
        'Não foi possível conectar à conta Binance. Verifique as credenciais e as permissões da API.';


      if (
        error?.code === -2015 ||
        error?.binanceCode === -2015
      ) {

        message =
          'API Key inválida, Secret inválido ou IP não autorizado pela Binance.';

      }


      else if (
        error?.code === -1021 ||
        error?.binanceCode === -1021
      ) {

        message =
          'O horário do servidor está fora da sincronização exigida pela Binance.';

      }


      else if (
        error?.code === -2014 ||
        error?.binanceCode === -2014
      ) {

        message =
          'API Key inválida ou não encontrada.';

      }


      return res.status(400).json({

        success: false,

        connected: false,

        message

      });

    }

  }
);


/*
 * =========================================================
 * CONSOLIDAR PEQUENOS SALDOS EM USDT
 * =========================================================
 *
 * Somente Spot. Não movimenta USDT, LDUSDT, stablecoins nem
 * ativos que estejam em posição OPEN do robô.
 *
 * O limite padrão é US$ 5 por ativo.
 */

async function obterCredenciaisConta(userId, accountId) {
  const result = await db.query(
    `SELECT id, api_key_encrypted, api_secret_encrypted, active
       FROM binance_accounts
      WHERE id = $1 AND user_id = $2`,
    [accountId, userId]
  );

  return result.rows[0] || null;
}

async function prepararPequenosSaldos(userId, accountId, limiteUSD = 5) {
  const account = await obterCredenciaisConta(userId, accountId);

  if (!account) {
    const error = new Error('Conta Binance não encontrada.');
    error.statusCode = 404;
    throw error;
  }

  if (account.active === false) {
    const error = new Error('A conta Binance selecionada está inativa.');
    error.statusCode = 400;
    throw error;
  }

  const apiKey = cryptoService.decrypt(account.api_key_encrypted);
  const apiSecret = cryptoService.decrypt(account.api_secret_encrypted);

  const client = Binance({
    apiKey,
    apiSecret,
    recvWindow: 60000
  });

  // IMPORTANTE: esta consulta usa exclusivamente a carteira SPOT.
  // Futuros, Earn/Funding e outras carteiras não entram nesta rotina.
  const accountInfo = await client.accountInfo();

  let prices = {};
  try {
    prices = await client.prices();
  } catch (_) {
    // O Binance Convert será usado como fonte principal da cotação.
  }

  const openResult = await db.query(
    `SELECT DISTINCT UPPER(symbol) AS symbol
       FROM robot_operations
      WHERE user_id = $1
        AND account_id = $2
        AND status = 'OPEN'`,
    [userId, accountId]
  );

  const openBases = new Set(
    openResult.rows
      .map(row => String(row.symbol || '').toUpperCase())
      .map(symbol => symbol.endsWith('USDT') ? symbol.slice(0, -4) : '')
      .filter(Boolean)
  );

  const candidates = [];

  for (const balance of accountInfo.balances || []) {
    const asset = String(balance.asset || '').toUpperCase();
    const free = Number(balance.free || 0);

    if (!asset || free <= 0) continue;
    if (asset === 'USDT' || asset === 'LDUSDT') continue;
    if (openBases.has(asset)) continue;

    // Não exigimos mais um par direto ASSET/USDT.
    // Alguns ativos possuem saldo na carteira, mas não aparecem no
    // objeto prices() com um par direto. A Binance Convert consegue
    // cotá-los diretamente.
    const directPrice = Number(
      prices[asset + 'USDT'] ||
      prices[asset + 'BUSD'] ||
      0
    );

    const estimatedUSD = directPrice > 0 ? free * directPrice : 0;

    // Se já sabemos que vale >= limite, não precisa consultar Convert.
    // Se não sabemos o preço, deixamos o getQuote da Binance decidir.
    if (estimatedUSD >= limiteUSD) continue;

    try {
      const quote = await binanceSignedPost(
        '/sapi/v1/convert/getQuote',
        apiKey,
        apiSecret,
        {
          fromAsset: asset,
          toAsset: 'USDT',
          fromAmount: String(free),
          validTime: '10s'
        }
      );

      const toAmount = Number(quote?.toAmount || 0);

      if (toAmount > 0 && toAmount < limiteUSD) {
        candidates.push({
          asset,
          free,
          estimatedUSD: estimatedUSD > 0 ? estimatedUSD : toAmount,
          quoteId: quote.quoteId,
          fromAmount: Number(quote.fromAmount || free),
          toAmount,
          ratio: Number(quote.ratio || 0)
        });
      }
    } catch (error) {
      // Ativo sem suporte/limite de Convert: apenas não entra na lista.
      console.warn(
        `[CONVERT] ${asset} não disponível para conversão:`,
        error?.message || error
      );
    }
  }

  return {
    limitUSD: limiteUSD,
    wallet: 'SPOT',
    candidates
  };
}

router.get(
  '/small-balances',
  authMiddleware,
  async (req, res) => {
    try {
      const accountId = Number(req.query.accountId);
      const limitUSD = Math.min(
        5,
        Math.max(0.01, Number(req.query.limitUSD || 5))
      );

      if (!Number.isInteger(accountId) || accountId <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Conta Binance inválida.'
        });
      }

      const result = await prepararPequenosSaldos(
        req.user.id,
        accountId,
        limitUSD
      );

      return res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('[CONVERT] ERRO AO CONSULTAR PEQUENOS SALDOS:', error);

      return res.status(error.statusCode || 500).json({
        success: false,
        message:
          error?.message ||
          'Não foi possível consultar os pequenos saldos.'
      });
    }
  }
);

router.post(
  '/small-balances/convert',
  authMiddleware,
  async (req, res) => {
    try {
      const accountId = Number(req.body?.accountId);
      const limitUSD = 5;

      if (!Number.isInteger(accountId) || accountId <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Conta Binance inválida.'
        });
      }

      /*
       * Recalcula os candidatos no momento da execução para não
       * usar uma cotação antiga. A cotação da Binance expira.
       */
      const prepared = await prepararPequenosSaldos(
        req.user.id,
        accountId,
        limitUSD
      );

      const account = await obterCredenciaisConta(
        req.user.id,
        accountId
      );

      const apiKey = cryptoService.decrypt(account.api_key_encrypted);
      const apiSecret = cryptoService.decrypt(account.api_secret_encrypted);

      const converted = [];
      const skipped = [];

      for (const item of prepared.candidates) {
        try {
          const quote = await binanceSignedPost(
            '/sapi/v1/convert/getQuote',
            apiKey,
            apiSecret,
            {
              fromAsset: item.asset,
              toAsset: 'USDT',
              fromAmount: String(item.fromAmount),
              validTime: '10s'
            }
          );

          if (!quote?.quoteId) {
            skipped.push({
              asset: item.asset,
              reason: 'A Binance não retornou uma cotação válida.'
            });
            continue;
          }

          const accepted = await binanceSignedPost(
            '/sapi/v1/convert/acceptQuote',
            apiKey,
            apiSecret,
            {
              quoteId: String(quote.quoteId)
            }
          );

          converted.push({
            asset: item.asset,
            fromAmount: Number(quote.fromAmount || item.fromAmount),
            toAmount: Number(quote.toAmount || 0),
            orderId: accepted?.orderId || null,
            status: accepted?.orderStatus || 'PROCESS'
          });
        } catch (error) {
          skipped.push({
            asset: item.asset,
            reason: error?.message || 'Conversão rejeitada pela Binance.'
          });
        }
      }

      return res.json({
        success: true,
        converted,
        skipped,
        message:
          converted.length
            ? `${converted.length} saldo(s) enviado(s) para conversão em USDT.`
            : 'Nenhum pequeno saldo pôde ser convertido.'
      });
    } catch (error) {
      console.error('[CONVERT] ERRO AO CONVERTER PEQUENOS SALDOS:', error);

      return res.status(error.statusCode || 500).json({
        success: false,
        message:
          error?.message ||
          'Não foi possível converter os pequenos saldos.'
      });
    }
  }
);



/*
 * =========================================================
 * CONVERSOR BRL -> USDT
 * =========================================================
 * Usa a conta Binance do próprio usuário.
 * As credenciais nunca chegam ao navegador.
 * Não utiliza saque/withdrawal.
 */

async function obterClienteBinanceSeguro(userId, accountId) {
  const account = await obterCredenciaisConta(userId, accountId);

  if (!account) {
    const error = new Error('Conta Binance não encontrada.');
    error.statusCode = 404;
    throw error;
  }

  if (account.active === false) {
    const error = new Error('A conta Binance selecionada está inativa.');
    error.statusCode = 400;
    throw error;
  }

  return {
    account,
    apiKey: cryptoService.decrypt(account.api_key_encrypted),
    apiSecret: cryptoService.decrypt(account.api_secret_encrypted)
  };
}

/*
 * =========================================================
 * EXCLUIR CONTA BINANCE
 * =========================================================
 */

router.delete(
  '/accounts/:id',
  authMiddleware,
  async (req, res) => {

    try {

      const accountId =
        req.params.id;


      const result = await db.query(

        `DELETE FROM binance_accounts
         WHERE id = $1
         AND user_id = $2
         RETURNING id, name`,

        [
          accountId,
          req.user.id
        ]

      );


      if (result.rows.length === 0) {

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


/*
 * =========================================================
 * EXPORTAR ROTAS
 * =========================================================
 */

module.exports = router;
