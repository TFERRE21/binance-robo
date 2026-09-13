const express = require('express');
const crypto = require('crypto');
const https = require('https');

const db = require('../services/db');
const authMiddleware = require('../middleware/auth');
const cryptoService = require('../services/cryptoService');
const Binance = require('binance-api-node').default;

const router = express.Router();

/*
 * Testa uma API Binance ANTES de salvar.
 * Não grava a API em banco.
 *
 * Fluxo:
 * API Key + Secret
 * -> accountInfo()
 * -> apiRestrictions()
 * -> retorna resultado
 */

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
            data = { code: response.statusCode, msg: body };
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
      request.destroy(new Error('Tempo esgotado ao conectar à Binance.'));
    });

    request.on('error', reject);
    request.end();
  });
}

/* Lista as contas Binance do usuário */
router.get('/accounts', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, active, created_at, updated_at
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
    console.error('ERRO AO LISTAR CONTAS BINANCE:', error);

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao listar contas Binance.'
    });
  }
});

/*
 * NOVA ROTA:
 * Testa credenciais fornecidas pelo formulário antes de salvar.
 */
router.post('/test-credentials', authMiddleware, async (req, res) => {
  try {
    const { apiKey, apiSecret } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        success: false,
        connected: false,
        message: 'API Key e API Secret são obrigatórios.'
      });
    }

    const cleanApiKey = String(apiKey).trim();
    const cleanApiSecret = String(apiSecret).trim();

    if (!cleanApiKey || !cleanApiSecret) {
      return res.status(400).json({
        success: false,
        connected: false,
        message: 'API Key e API Secret não podem estar vazias.'
      });
    }

    // 1. Valida a chave/secret com uma chamada autenticada.
    const client = Binance({
      apiKey: cleanApiKey,
      apiSecret: cleanApiSecret
    });

    const accountInfo = await client.accountInfo();

    // 2. Consulta as permissões reais da API Key.
    let restrictions;

    try {
      restrictions = await binanceSignedGet(
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
          'As credenciais foram recebidas, mas não foi possível consultar as permissões desta API. Verifique se a chave permite leitura da conta.',
        binanceCode: permissionError.binanceCode
      });
    }

    return res.json({
      success: true,
      connected: true,
      message: 'Conexão com a Binance realizada com sucesso.',
      permissions: {
        canRead:
          restrictions.enableReading === true ||
          restrictions.enableReading === undefined
            ? restrictions.enableReading !== false
            : false,
        canTrade:
          restrictions.enableSpotAndMarginTrading === true ||
          accountInfo.canTrade === true,
        canWithdraw: restrictions.enableWithdrawals === true,
        canDeposit: restrictions.enableInternalTransfer === true
      },
      security: {
        withdrawalsDisabled: restrictions.enableWithdrawals === false
      }
    });
  } catch (error) {
    console.error('ERRO AO TESTAR CREDENCIAIS BINANCE:', error);

    let message =
      'Não foi possível conectar à Binance. Verifique a API Key, API Secret e as permissões da chave.';

    if (error?.code === -2015) {
      message =
        'API Key inválida, Secret inválido ou IP não autorizado pela Binance.';
    } else if (error?.code === -1021) {
      message =
        'O horário do servidor está fora da sincronização exigida pela Binance. Tente novamente.';
    } else if (error?.code === -2014) {
      message = 'API Key inválida ou não encontrada.';
    } else if (error?.message) {
      message = error.message;
    }

    return res.status(400).json({
      success: false,
      connected: false,
      message,
      binanceCode: error?.code || error?.binanceCode || null
    });
  }
});

/* Cadastra a conta Binance do usuário */
router.post('/accounts', authMiddleware, async (req, res) => {
  try {
    const { name, apiKey, apiSecret } = req.body;

    if (!name || !apiKey || !apiSecret) {
      return res.status(400).json({
        success: false,
        message: 'Nome, API Key e API Secret são obrigatórios.'
      });
    }

    const apiKeyEncrypted = cryptoService.encrypt(apiKey);
    const apiSecretEncrypted = cryptoService.encrypt(apiSecret);

    const result = await db.query(
      `INSERT INTO binance_accounts
       (user_id, name, api_key_encrypted, api_secret_encrypted, active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, active, created_at, updated_at`,
      [
        req.user.id,
        name,
        apiKeyEncrypted,
        apiSecretEncrypted
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Conta Binance cadastrada com sucesso.',
      account: result.rows[0]
    });
  } catch (error) {
    console.error('ERRO AO CADASTRAR CONTA BINANCE:', error);

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao cadastrar conta Binance.'
    });
  }
});

/* Testa uma conta Binance já salva */
router.get('/accounts/:id/test', authMiddleware, async (req, res) => {
  try {
    const accountId = req.params.id;

    const result = await db.query(
      `SELECT id, name, api_key_encrypted, api_secret_encrypted, active
       FROM binance_accounts
       WHERE id = $1
       AND user_id = $2`,
      [accountId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Conta Binance não encontrada.'
      });
    }

    const account = result.rows[0];

    if (!account.active) {
      return res.status(400).json({
        success: false,
        message: 'Esta conta Binance está inativa.'
      });
    }

    const apiKey = cryptoService.decrypt(account.api_key_encrypted);
    const apiSecret = cryptoService.decrypt(account.api_secret_encrypted);

    const client = Binance({
      apiKey,
      apiSecret
    });

    const accountInfo = await client.accountInfo();

    let restrictions = null;

    try {
      restrictions = await binanceSignedGet(
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

    return res.json({
      success: true,
      connected: true,
      message: 'Conexão com a Binance realizada com sucesso.',
      account: {
        id: account.id,
        name: account.name
      },
      permissions: {
        canRead:
          restrictions?.enableReading !== false,
        canTrade:
          restrictions?.enableSpotAndMarginTrading === true ||
          accountInfo.canTrade === true,
        canWithdraw:
          restrictions?.enableWithdrawals === true,
        canDeposit:
          restrictions?.enableInternalTransfer === true
      },
      security: {
        withdrawalsDisabled:
          restrictions?.enableWithdrawals === false
      }
    });
  } catch (error) {
    console.error('ERRO AO TESTAR CONEXÃO BINANCE:', error);

    return res.status(400).json({
      success: false,
      connected: false,
      message:
        'Não foi possível conectar à conta Binance. Verifique as credenciais e as permissões da API.'
    });
  }
});

/* Exclui a conta Binance do usuário */
router.delete('/accounts/:id', authMiddleware, async (req, res) => {
  try {
    const accountId = req.params.id;

    const result = await db.query(
      `DELETE FROM binance_accounts
       WHERE id = $1
       AND user_id = $2
       RETURNING id, name`,
      [accountId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Conta Binance não encontrada.'
      });
    }

    return res.json({
      success: true,
      message: 'Conta Binance excluída com sucesso.',
      account: result.rows[0]
    });
  } catch (error) {
    console.error('ERRO AO EXCLUIR CONTA BINANCE:', error);

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao excluir conta Binance.'
    });
  }
});

module.exports = router;
