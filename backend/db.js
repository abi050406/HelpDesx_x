const { Pool } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const pool = new Pool({
  user: process.env.DB_USER || 'dev_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'nextgen_dev',
  password: process.env.DB_PASSWORD || 'dev_password',
  port: Number(process.env.DB_PORT || 5432),
});

module.exports = pool;
