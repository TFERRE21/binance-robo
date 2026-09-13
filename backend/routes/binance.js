const express = require('express');
const db = require('../services/db');
const authMiddleware = require('../middleware/auth');
const cryptoService = require('../services/cryptoService');
const Binance = require('binance-api-node').default;

const router = express.Router();

// =========================================================
// LISTAR CONTAS BINANCE DO USUARIO LOGADO
// =========================================================

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

// =========================================================
// CADASTRAR CONTA BINANCE
// =========================================================

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

// =========================================================
// TESTAR CONEXÃO COM A BINANCE
// SOMENTE LEITURA - NÃO EXECUTA ORDENS
// =========================================================

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

    const apiKey = cryptoService.decrypt(
      account.api_key_encrypted
    );

    const apiSecret = cryptoService.decrypt(
      account.api_secret_encrypted
    );

    const client = Binance({
      apiKey,
      apiSecret
    });

    // Consulta somente informações da conta.
    // Nenhuma ordem é criada, alterada ou cancelada.
    const accountInfo = await client.accountInfo();

    return res.json({
      success: true,
      connected: true,
      message: 'Conexão com a Binance realizada com sucesso.',
      account: {
        id: account.id,
        name: account.name
      },
      permissions: {
        canTrade: accountInfo.canTrade,
        canWithdraw: accountInfo.canWithdraw,
        canDeposit: accountInfo.canDeposit
      }
    });

  } catch (error) {
    console.error('ERRO AO TESTAR CONEXÃO BINANCE:', error);

    return res.status(400).json({
      success: false,
      connected: false,
      message: 'Não foi possível conectar à conta Binance. Verifique as credenciais e as permissões da API.'
    });
  }
});

// =========================================================
// EXCLUIR CONTA BINANCE
// =========================================================

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
