const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../services/db');

const {
  enviarEmailRecuperacaoSenha
} = require('../services/emailService');

const router = express.Router();


// ============================================================
// TESTE DA ROTA
// ============================================================

router.get('/teste', (req, res) => {
  res.json({
    success: true,
    message: 'Rota de autenticacao OK'
  });
});


// ============================================================
// CADASTRO
// ============================================================

router.post('/register', async (req, res) => {
  try {

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nome, e-mail e senha são obrigatórios.'
      });
    }

    const emailNormalizado =
      email.trim().toLowerCase();

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

    const passwordHash =
      await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO users
       (name, email, password_hash, active)
       VALUES
       ($1, $2, $3, true)
       RETURNING id, name, email, active, created_at`,
      [
        name.trim(),
        emailNormalizado,
        passwordHash
      ]
    );

    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso.',
      user
    });

  } catch (error) {

    console.error(
      'ERRO NO CADASTRO:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao criar usuário.'
    });
  }
});


// ============================================================
// LOGIN
// ============================================================

router.post('/login', async (req, res) => {
  try {

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'E-mail e senha são obrigatórios.'
      });
    }

    const emailNormalizado =
      email.trim().toLowerCase();

    const result = await db.query(
      `SELECT
        id,
        name,
        email,
        password_hash,
        active
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

    const passwordOk =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    if (!passwordOk) {
      return res.status(401).json({
        success: false,
        message: 'E-mail ou senha inválidos.'
      });
    }

    const token =
      jwt.sign(
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

    console.error(
      'ERRO NO LOGIN:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao realizar login.'
    });
  }
});


// ============================================================
// USUÁRIO LOGADO
// ============================================================

const authMiddleware =
  require('../middleware/auth');

router.get('/me', authMiddleware, async (req, res) => {

  try {

    const result = await db.query(
      `SELECT
        id,
        name,
        email,
        active,
        created_at,
        updated_at
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

    console.error(
      'ERRO AO BUSCAR USUARIO:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao buscar usuário.'
    });
  }

});


// ============================================================
// RECUPERAÇÃO DE SENHA
// ============================================================

router.post('/forgot-password', async (req, res) => {

  try {

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Informe o e-mail.'
      });
    }

    const emailNormalizado =
      String(email)
        .trim()
        .toLowerCase();


    // --------------------------------------------------------
    // BUSCAR USUÁRIO
    // --------------------------------------------------------

    const result = await db.query(
      `
      SELECT
        id,
        name,
        email,
        active
      FROM users
      WHERE LOWER(email) = $1
      LIMIT 1
      `,
      [emailNormalizado]
    );


    // --------------------------------------------------------
    // RESPOSTA GENÉRICA
    // --------------------------------------------------------

    if (result.rows.length === 0) {

      return res.json({
        success: true,
        message:
          'Se o e-mail estiver cadastrado, você receberá as instruções para redefinir sua senha.'
      });

    }


    const user = result.rows[0];


    // --------------------------------------------------------
    // USUÁRIO INATIVO
    // --------------------------------------------------------

    if (user.active === false) {

      return res.json({
        success: true,
        message:
          'Se o e-mail estiver cadastrado, você receberá as instruções para redefinir sua senha.'
      });

    }


    // --------------------------------------------------------
    // GERAR TOKEN
    // --------------------------------------------------------

    const resetToken =
      crypto
        .randomBytes(32)
        .toString('hex');


    // --------------------------------------------------------
    // HASH DO TOKEN
    // --------------------------------------------------------

    const tokenHash =
      crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');


    // --------------------------------------------------------
    // VALIDADE: 30 MINUTOS
    // --------------------------------------------------------

    const expiresAt =
      new Date(
        Date.now() +
        30 * 60 * 1000
      );


    // --------------------------------------------------------
    // INVALIDAR TOKENS ANTERIORES
    // --------------------------------------------------------

    await db.query(
      `
      UPDATE password_resets
      SET used = TRUE
      WHERE user_id = $1
      AND used = FALSE
      `,
      [user.id]
    );


    // --------------------------------------------------------
    // SALVAR TOKEN
    // --------------------------------------------------------

    await db.query(
      `
      INSERT INTO password_resets
      (
        user_id,
        token_hash,
        expires_at,
        used
      )
      VALUES
      (
        $1,
        $2,
        $3,
        FALSE
      )
      `,
      [
        user.id,
        tokenHash,
        expiresAt
      ]
    );


    // --------------------------------------------------------
    // MONTAR LINK
    // --------------------------------------------------------

    const host =
      req.get('host');

    const protocolo =
      req.headers['x-forwarded-proto'] ||
      'https';

    const linkRecuperacao =
      `${protocolo}://${host}/reset-password.html?token=${encodeURIComponent(resetToken)}`;


    // --------------------------------------------------------
    // ENVIAR E-MAIL
    // --------------------------------------------------------

    try {

      await enviarEmailRecuperacaoSenha({

        email: user.email,

        nome: user.name,

        link: linkRecuperacao

      });

      console.log(
        `E-MAIL DE RECUPERAÇÃO ENVIADO: ${user.email}`
      );

    } catch (emailError) {

      console.error(
        'ERRO AO ENVIAR E-MAIL DE RECUPERAÇÃO:',
        emailError
      );


      // ------------------------------------------------------
      // INVALIDAR TOKEN SE O ENVIO FALHAR
      // ------------------------------------------------------

      await db.query(
        `
        UPDATE password_resets
        SET used = TRUE
        WHERE token_hash = $1
        `,
        [tokenHash]
      );


      return res.status(500).json({
        success: false,
        message:
          'Não foi possível enviar o e-mail de recuperação. Tente novamente.'
      });

    }


    // --------------------------------------------------------
    // RESPOSTA
    // --------------------------------------------------------

    return res.json({
      success: true,
      message:
        'Se o e-mail estiver cadastrado, você receberá as instruções para redefinir sua senha.'
    });


  } catch (error) {

    console.error(
      'ERRO NA RECUPERAÇÃO DE SENHA:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Não foi possível iniciar a recuperação de senha.'
    });

  }

});


// ============================================================
// REDEFINIR SENHA
// ============================================================

router.post('/reset-password', async (req, res) => {

  try {

    const {
      token,
      password
    } = req.body;


    // --------------------------------------------------------
    // VALIDAR DADOS
    // --------------------------------------------------------

    if (!token || !password) {

      return res.status(400).json({
        success: false,
        message:
          'Token e nova senha são obrigatórios.'
      });

    }


    // --------------------------------------------------------
    // VALIDAR SENHA
    // --------------------------------------------------------

    if (typeof password !== 'string') {

      return res.status(400).json({
        success: false,
        message:
          'A senha informada é inválida.'
      });

    }


    if (password.length < 6) {

      return res.status(400).json({
        success: false,
        message:
          'A senha deve ter pelo menos 6 caracteres.'
      });

    }


    // --------------------------------------------------------
    // GERAR HASH DO TOKEN RECEBIDO
    // --------------------------------------------------------

    const tokenHash =
      crypto
        .createHash('sha256')
        .update(String(token))
        .digest('hex');


    // --------------------------------------------------------
    // BUSCAR TOKEN
    // --------------------------------------------------------

    const result = await db.query(
      `
      SELECT
        pr.id,
        pr.user_id,
        pr.expires_at,
        pr.used,
        u.active
      FROM password_resets pr
      INNER JOIN users u
        ON u.id = pr.user_id
      WHERE pr.token_hash = $1
      LIMIT 1
      `,
      [tokenHash]
    );


    // --------------------------------------------------------
    // TOKEN NÃO ENCONTRADO
    // --------------------------------------------------------

    if (result.rows.length === 0) {

      return res.status(400).json({
        success: false,
        message:
          'Link de recuperação inválido ou expirado.'
      });

    }


    const reset = result.rows[0];


    // --------------------------------------------------------
    // TOKEN JÁ UTILIZADO
    // --------------------------------------------------------

    if (reset.used) {

      return res.status(400).json({
        success: false,
        message:
          'Este link de recuperação já foi utilizado.'
      });

    }


    // --------------------------------------------------------
    // USUÁRIO INATIVO
    // --------------------------------------------------------

    if (!reset.active) {

      return res.status(400).json({
        success: false,
        message:
          'Esta conta está inativa.'
      });

    }


    // --------------------------------------------------------
    // VERIFICAR EXPIRAÇÃO
    // --------------------------------------------------------

    const agora =
      new Date();

    const expiracao =
      new Date(reset.expires_at);


    if (expiracao <= agora) {

      await db.query(
        `
        UPDATE password_resets
        SET used = TRUE
        WHERE id = $1
        `,
        [reset.id]
      );


      return res.status(400).json({
        success: false,
        message:
          'O link de recuperação expirou. Solicite uma nova recuperação de senha.'
      });

    }


    // --------------------------------------------------------
    // GERAR NOVO HASH DA SENHA
    // --------------------------------------------------------

    const passwordHash =
      await bcrypt.hash(
        password,
        12
      );


    // --------------------------------------------------------
    // ALTERAR SENHA
    // --------------------------------------------------------

    await db.query(
      `
      UPDATE users
      SET
        password_hash = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        passwordHash,
        reset.user_id
      ]
    );


    // --------------------------------------------------------
    // INVALIDAR TOKEN UTILIZADO
    // --------------------------------------------------------

    await db.query(
      `
      UPDATE password_resets
      SET used = TRUE
      WHERE id = $1
      `,
      [reset.id]
    );


    // --------------------------------------------------------
    // INVALIDAR OUTROS TOKENS DO USUÁRIO
    // --------------------------------------------------------

    await db.query(
      `
      UPDATE password_resets
      SET used = TRUE
      WHERE user_id = $1
      AND used = FALSE
      `,
      [reset.user_id]
    );


    // --------------------------------------------------------
    // SUCESSO
    // --------------------------------------------------------

    console.log(
      `SENHA REDEFINIDA COM SUCESSO - USUARIO ID: ${reset.user_id}`
    );


    return res.json({

      success: true,

      message:
        'Senha redefinida com sucesso.'

    });


  } catch (error) {

    console.error(
      'ERRO AO REDEFINIR SENHA:',
      error
    );


    return res.status(500).json({

      success: false,

      message:
        'Não foi possível redefinir a senha.'

    });

  }

});


// ============================================================
// EXPORTAR ROTAS
// ============================================================

module.exports = router;
