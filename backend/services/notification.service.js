const pool = require('../db');

const MAX_LIMIT = 100;
const ALLOWED_SEVERITIES = new Set(['info', 'success', 'warning', 'danger', 'critical']);

function queryTarget(client) {
  return client || pool;
}

function cleanNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    username: row.username,
    ticket_id: row.ticket_id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    payload: row.payload || {},
    read_at: row.read_at,
    seen_at: row.seen_at,
    created_at: row.created_at,
  };
}

async function createNotification({
  userId = null,
  username = null,
  ticketId = null,
  type,
  severity = 'info',
  title,
  body = null,
  payload = {},
  client = null,
}) {
  const cleanType = String(type || '').trim();
  const cleanTitle = String(title || '').trim();
  const cleanSeverity = ALLOWED_SEVERITIES.has(String(severity)) ? String(severity) : 'info';
  if (!cleanType || !cleanTitle) throw new Error('type y title son obligatorios para notification_log.');

  const result = await queryTarget(client).query(
    `INSERT INTO notification_log(user_id,username,ticket_id,type,severity,title,body,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING *`,
    [
      userId ? Number(userId) : null,
      username || null,
      ticketId ? Number(ticketId) : null,
      cleanType,
      cleanSeverity,
      cleanTitle,
      body || null,
      JSON.stringify(payload || {}),
    ]
  );
  return cleanNotification(result.rows[0]);
}

async function listNotifications({ userId = null, username = null, onlyUnread = false, limit = 20 }) {
  const params = [];
  const where = [];
  const numericLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_LIMIT);

  if (userId) {
    params.push(Number(userId));
    where.push(`user_id=$${params.length}`);
  }
  if (username) {
    params.push(String(username).trim().toLowerCase());
    where.push(`LOWER(username)=LOWER($${params.length})`);
  }
  if (onlyUnread) where.push('read_at IS NULL');

  params.push(numericLimit);
  const result = await pool.query(
    `SELECT * FROM notification_log
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(cleanNotification);
}

async function markNotificationRead(notificationId, userId = null) {
  const numericId = Number(notificationId);
  if (!numericId) throw new Error('notificationId inválido.');
  const params = [numericId];
  let ownerSql = '';
  if (userId) {
    params.push(Number(userId));
    ownerSql = `AND (user_id=$${params.length} OR user_id IS NULL)`;
  }
  const result = await pool.query(
    `UPDATE notification_log
     SET read_at=COALESCE(read_at, NOW())
     WHERE id=$1 ${ownerSql}
     RETURNING *`,
    params
  );
  return cleanNotification(result.rows[0]);
}

async function markNotificationSeen(notificationId, userId = null) {
  const numericId = Number(notificationId);
  if (!numericId) throw new Error('notificationId inválido.');
  const params = [numericId];
  let ownerSql = '';
  if (userId) {
    params.push(Number(userId));
    ownerSql = `AND (user_id=$${params.length} OR user_id IS NULL)`;
  }
  const result = await pool.query(
    `UPDATE notification_log
     SET seen_at=COALESCE(seen_at, NOW())
     WHERE id=$1 ${ownerSql}
     RETURNING *`,
    params
  );
  return cleanNotification(result.rows[0]);
}

module.exports = { createNotification, listNotifications, markNotificationRead, markNotificationSeen };
