const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../services/db');

const router = express.Router();

router.get('/teste', (req, res) => {
  res.json({
    success: true,
    message: 'Rota de autenticacao OK'
  });
});

module.exports = router;
