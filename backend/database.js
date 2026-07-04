const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./db');

async function initializeDatabase() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      checksum TEXT NULL,
      executed_at TIMESTAMP DEFAULT NOW()
    );
  `);

  for (const file of migrationFiles) {
    const alreadyExecuted = await pool.query('SELECT id FROM schema_migrations WHERE filename=$1 LIMIT 1', [file]);
    if (alreadyExecuted.rows[0]) continue;

    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    const client = await pool.connect();
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations(filename, checksum) VALUES($1, $2) ON CONFLICT(filename) DO NOTHING',
        [file, checksum]
      );
    } catch (error) {
      console.error(`Error ejecutando migración ${file}:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { initializeDatabase };
