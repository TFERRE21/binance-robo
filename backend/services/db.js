const { Pool } = require('pg');

const useSsl =
  String(process.env.POSTGRES_SSL || 'false').toLowerCase() === 'true';

const pool = new Pool({
  connectionString: process.env.NF_POSTGRESQL_POSTGRES_URI,

  ssl: useSsl
    ? {
        rejectUnauthorized: false
      }
    : false
});

module.exports = pool;
