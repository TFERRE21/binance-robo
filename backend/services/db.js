const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.NF_POSTGRESQL_POSTGRES_URI,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = pool;
