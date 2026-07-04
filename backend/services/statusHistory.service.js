const pool = require('../db');

function queryTarget(client) {
  return client || pool;
}

async function recordStatusChange({
  ticketId,
  fromStatus = null,
  toStatus,
  actorId = null,
  actorName = null,
  actorRole = null,
  reason = null,
  metadata = {},
  client = null,
}) {
  const numericTicketId = Number(ticketId);
  const cleanToStatus = String(toStatus || '').trim();
  if (!numericTicketId || !cleanToStatus) throw new Error('ticketId y toStatus son obligatorios para historial de estados.');

  const result = await queryTarget(client).query(
    `INSERT INTO ticket_status_history (
       ticket_id, from_status, to_status, actor_id, actor_name, actor_role, reason, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING id,ticket_id,from_status,to_status,actor_id,actor_name,actor_role,reason,metadata,created_at`,
    [
      numericTicketId,
      fromStatus || null,
      cleanToStatus,
      actorId ? Number(actorId) : null,
      actorName || null,
      actorRole || null,
      reason || null,
      JSON.stringify(metadata || {}),
    ]
  );
  return result.rows[0];
}

async function getTicketHistory(ticketId) {
  const numericTicketId = Number(ticketId);
  if (!numericTicketId) throw new Error('ticketId inválido.');
  const result = await pool.query(
    `SELECT id,ticket_id,from_status,to_status,actor_id,actor_name,actor_role,reason,metadata,created_at
     FROM ticket_status_history
     WHERE ticket_id=$1
     ORDER BY created_at ASC, id ASC`,
    [numericTicketId]
  );
  return result.rows;
}

module.exports = { recordStatusChange, getTicketHistory };
