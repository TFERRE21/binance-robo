const express = require('express');
const db = require('../services/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;
