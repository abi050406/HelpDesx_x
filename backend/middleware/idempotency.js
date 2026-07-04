const crypto = require('crypto');
const pool = require('../db');

function requestHash(req) {
  return crypto.createHash('sha256').update(JSON.stringify({
    method: req.method,
    path: req.baseUrl + req.path,
    actor: req.user?.id || null,
    body: req.body || {},
  })).digest('hex');
}

async function idempotency(req, res, next) {
  const key = String(req.get('Idempotency-Key') || '').trim();
  if (!key) return next();
  if (key.length > 160) return res.status(400).json({ success: false, error: 'Idempotency-Key inválido.' });

  const scope = `${req.user?.id || 'anonymous'}:${req.method}:${req.baseUrl}${req.path}`;
  const hash = requestHash(req);
  const reserved = await pool.query(
    `INSERT INTO idempotency_keys(scope,idempotency_key,request_hash,status_code,response_json)
     VALUES($1,$2,$3,102,'{}'::jsonb)
     ON CONFLICT(scope,idempotency_key) DO NOTHING
     RETURNING id`,
    [scope, key, hash]
  );
  if (!reserved.rows[0]) {
    const existing = await pool.query(
      `SELECT request_hash,status_code,response_json
       FROM idempotency_keys WHERE scope=$1 AND idempotency_key=$2`,
      [scope, key]
    );
    if (existing.rows[0]?.request_hash !== hash) {
      return res.status(409).json({ success: false, code: 'IDEMPOTENCY_KEY_REUSED', error: 'La llave de idempotencia ya fue usada con otros datos.' });
    }
    if (existing.rows[0]?.status_code === 102) {
      return res.status(409).json({ success: false, code: 'REQUEST_IN_PROGRESS', error: 'Ya hay una solicitud idéntica en proceso.' });
    }
    return res.status(existing.rows[0].status_code).json(existing.rows[0].response_json);
  }

  const originalJson = res.json.bind(res);
  res.json = async (payload) => {
    const statusCode = res.statusCode;
    if (statusCode < 500) {
      await pool.query(
        `UPDATE idempotency_keys SET status_code=$3,response_json=$4::jsonb
         WHERE scope=$1 AND idempotency_key=$2`,
        [scope, key, statusCode, JSON.stringify(payload ?? null)]
      ).catch((error) => console.error('No se pudo persistir idempotencia:', error.message));
    } else {
      await pool.query(
        `DELETE FROM idempotency_keys WHERE scope=$1 AND idempotency_key=$2 AND status_code=102`,
        [scope, key]
      ).catch(() => {});
    }
    return originalJson(payload);
  };
  return next();
}

module.exports = { idempotency, requestHash };
