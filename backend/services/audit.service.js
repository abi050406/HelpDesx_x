const pool = require('../db');

async function logAudit({
  actorId = null,
  actorUsername = null,
  actorRole = null,
  action,
  entity,
  entityId = null,
  detail = {},
  before = null,
  after = null,
  client = null,
}) {
  if (!action || !entity) return null;
  const target = client || pool;
  const afterSnapshot = after == null ? detail : after;
  const result = await target.query(
    `INSERT INTO auditoria_sistema(
       actor_id,actor_username,actor_role,accion,entidad,action,entity_type,
       entidad_id,detalle,before_json,after_json
     ) VALUES(
       $1,
       COALESCE($2,(SELECT username FROM app_users WHERE id=$1)),
       COALESCE($3,(SELECT role FROM app_users WHERE id=$1)),
       $4,$5,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb
     )
     RETURNING *`,
    [
      actorId,
      actorUsername,
      actorRole,
      action,
      entity,
      entityId,
      JSON.stringify(detail || {}),
      before == null ? null : JSON.stringify(before),
      afterSnapshot == null ? null : JSON.stringify(afterSnapshot),
    ]
  );
  return result.rows[0];
}

module.exports = { logAudit };
