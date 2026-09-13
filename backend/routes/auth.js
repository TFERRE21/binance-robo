const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../services/db');

const router = express.Router();

// TESTE DA ROTA
router.get('/teste', (req, res) => {
  res.json({
    success: true,
    message: 'Rota de autenticacao OK'
  });
});

// CADASTRO
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nome, e-mail e senha são obrigatórios.'
      });
    }

    const emailNormalizado = email.trim().toLowerCase();

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'A senha deve ter pelo menos 6 caracteres.'
      });
    }

    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [emailNormalizado]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Este e-mail já está cadastrado.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO users (name, email, password_hash, active)
       VALUES ($1, $2, $3, true)
       RETURNING id, name, email, active, created_at`,
      [name.trim(), emailNormalizado, passwordHash]
    );

    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso.',
      user
    });

  } catch (error) {
    console.error('ERRO NO CADASTRO:', error);

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao criar usuário.'
    });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'E-mail e senha são obrigatórios.'
      });
    }

    const emailNormalizado = email.trim().toLowerCase();

    const result = await db.query(
      `SELECT id, name, email, password_hash, active
       FROM users
       WHERE email = $1`,
      [emailNormalizado]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'E-mail ou senha inválidos.'
      });
    }

    const user = result.rows[0];

    if (!user.active) {
      return res.status(403).json({
        success: false,
        message: 'Usuário inativo.'
      });
    }

    const passwordOk = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordOk) {
      return res.status(401).json({
        success: false,
        message: 'E-mail ou senha inválidos.'
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email
      },
      process.env.JWT_SECRET,
      {
        expiresIn: '7d'
      }
    );

    return res.json({
      success: true,
      message: 'Login realizado com sucesso.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.error('ERRO NO LOGIN:', error);

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao realizar login.'
    });
  }
});

const authMiddleware = require('../middleware/auth');

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, email, active, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado.'
      });
    }

    return res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('ERRO AO BUSCAR USUARIO:', error);

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao buscar usuário.'
    });
  }
});
module.exports = router;
