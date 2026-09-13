const express = require('express');
const db = require('../services/db');
const authMiddleware = require('../middleware/auth');
const cryptoService = require('../services/cryptoService');

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

module.exports = router;
