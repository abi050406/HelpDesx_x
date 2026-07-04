const express = require('express');
const pool = require('../db');
const { requireAuth } = require('./auth.routes');
const { logAudit } = require('../services/audit.service');
const { emitToUser } = require('../services/realtime.service');
const {
  canManageChat,
  canAccessChat,
  canAddChatMember,
  validateChatMessage,
} = require('../domain/chatPolicy');

const router = express.Router();
router.use(requireAuth);

function adminOnly(req, res, next) {
  if (!canManageChat(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Solo el administrador puede gestionar el chat.' });
  }
  return next();
}

async function groupAccess(user, groupId, queryable = pool) {
  const result = await queryable.query(
    `SELECT g.*,
            EXISTS (
              SELECT 1 FROM chat_group_members m
              WHERE m.group_id=g.id AND m.user_id=$2 AND m.is_active=TRUE
            ) AS is_active_member
     FROM chat_groups g WHERE g.id=$1`,
    [groupId, user.id]
  );
  const group = result.rows[0];
  return {
    group,
    allowed: Boolean(group) && canAccessChat(user.role, group.is_active_member),
  };
}

async function audienceIds(groupId) {
  const result = await pool.query(
    `SELECT user_id AS id FROM chat_group_members
     WHERE group_id=$1 AND is_active=TRUE
     UNION
     SELECT id FROM app_users WHERE role='admin' AND is_active=TRUE`,
    [groupId]
  );
  return result.rows.map((row) => Number(row.id));
}

async function emitToChatAudience(groupId, event, payload) {
  const ids = await audienceIds(groupId);
  for (const id of ids) emitToUser(id, event, payload);
}

router.get('/groups', async (req, res) => {
  try {
    const params = [];
    let where = '';
    let join = '';
    if (req.user.role !== 'admin') {
      params.push(req.user.id);
      join = `JOIN chat_group_members membership
                ON membership.group_id=g.id
               AND membership.user_id=$1
               AND membership.is_active=TRUE`;
      where = 'WHERE g.is_active=TRUE';
    }
    const result = await pool.query(
      `SELECT g.*,
              creator.full_name AS created_by_name,
              COUNT(DISTINCT members.user_id) FILTER(WHERE members.is_active=TRUE)::int AS member_count,
              MAX(messages.created_at) AS last_message_at
       FROM chat_groups g
       ${join}
       LEFT JOIN app_users creator ON creator.id=g.created_by
       LEFT JOIN chat_group_members members ON members.group_id=g.id
       LEFT JOIN chat_messages messages ON messages.group_id=g.id
       ${where}
       GROUP BY g.id,creator.full_name
       ORDER BY COALESCE(MAX(messages.created_at),g.updated_at) DESC,g.id DESC`,
      params
    );
    res.json({ success: true, groups: result.rows });
  } catch (error) {
    console.error('Error listando grupos de chat:', error);
    res.status(500).json({ success: false, error: 'No se pudieron consultar los grupos.' });
  }
});

router.post('/groups', adminOnly, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim() || null;
  if (!name || name.length > 120) {
    return res.status(400).json({ success: false, error: 'El nombre es obligatorio y admite hasta 120 caracteres.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO chat_groups(name,description,created_by)
       VALUES($1,$2,$3) RETURNING *`,
      [name, description, req.user.id]
    );
    await client.query(
      `INSERT INTO chat_group_members(group_id,user_id,added_by,role_in_group)
       VALUES($1,$2,$2,'owner')
       ON CONFLICT(group_id,user_id) DO UPDATE SET is_active=TRUE,role_in_group='owner'`,
      [result.rows[0].id, req.user.id]
    );
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'chat.group.created',
      entity: 'chat_groups',
      entityId: result.rows[0].id,
      after: result.rows[0],
      client,
    });
    await client.query('COMMIT');
    await emitToChatAudience(result.rows[0].id, 'chat:group_created', result.rows[0]);
    res.status(201).json({ success: true, group: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: 'No se pudo crear el grupo.' });
  } finally {
    client.release();
  }
});

router.put('/groups/:id', adminOnly, async (req, res) => {
  const groupId = Number(req.params.id);
  const name = req.body.name === undefined ? null : String(req.body.name).trim();
  const description = req.body.description === undefined ? undefined : String(req.body.description || '').trim() || null;
  if (name !== null && (!name || name.length > 120)) {
    return res.status(400).json({ success: false, error: 'El nombre debe tener entre 1 y 120 caracteres.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(`SELECT * FROM chat_groups WHERE id=$1 FOR UPDATE`, [groupId]);
    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Grupo no encontrado.' });
    }
    const result = await client.query(
      `UPDATE chat_groups
       SET name=COALESCE($2,name),
           description=CASE WHEN $3::boolean THEN $4 ELSE description END,
           is_active=COALESCE($5,is_active),
           updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [groupId, name, req.body.description !== undefined, description, req.body.is_active]
    );
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'chat.group.updated',
      entity: 'chat_groups',
      entityId: groupId,
      before: before.rows[0],
      after: result.rows[0],
      client,
    });
    await client.query('COMMIT');
    res.json({ success: true, group: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: 'No se pudo actualizar el grupo.' });
  } finally {
    client.release();
  }
});

router.delete('/groups/:id', adminOnly, async (req, res) => {
  const groupId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(`SELECT * FROM chat_groups WHERE id=$1 FOR UPDATE`, [groupId]);
    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Grupo no encontrado.' });
    }
    const result = await client.query(
      `UPDATE chat_groups SET is_active=FALSE,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [groupId]
    );
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'chat.group.closed',
      entity: 'chat_groups',
      entityId: groupId,
      before: before.rows[0],
      after: result.rows[0],
      client,
    });
    await client.query('COMMIT');
    res.json({ success: true, group: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: 'No se pudo cerrar el grupo.' });
  } finally {
    client.release();
  }
});

router.get('/groups/:id/members', async (req, res) => {
  const groupId = Number(req.params.id);
  const access = await groupAccess(req.user, groupId);
  if (!access.group) return res.status(404).json({ success: false, error: 'Grupo no encontrado.' });
  if (!access.allowed) return res.status(403).json({ success: false, error: 'No perteneces a este grupo.' });
  const result = await pool.query(
    `SELECT m.id,m.group_id,m.user_id,m.role_in_group,m.is_active,m.created_at,
            u.username,u.full_name,
            CASE u.role WHEN 'tecnico' THEN 'tech' WHEN 'asociado' THEN 'associate' ELSE u.role END AS role
     FROM chat_group_members m
     JOIN app_users u ON u.id=m.user_id
     WHERE m.group_id=$1 AND m.is_active=TRUE
     ORDER BY u.full_name`,
    [groupId]
  );
  res.json({ success: true, members: result.rows });
});

router.post('/groups/:id/members', adminOnly, async (req, res) => {
  const groupId = Number(req.params.id);
  const userId = Number(req.body.user_id ?? req.body.userId);
  if (!userId) return res.status(400).json({ success: false, error: 'user_id es obligatorio.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [group, user] = await Promise.all([
      client.query(`SELECT id,is_active FROM chat_groups WHERE id=$1`, [groupId]),
      client.query(`SELECT id,username,full_name,role,is_active FROM app_users WHERE id=$1`, [userId]),
    ]);
    if (!group.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Grupo no encontrado.' });
    }
    if (!user.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }
    if (!canAddChatMember(req.user.role, user.rows[0].role)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'El usuario no tiene un rol válido para el chat.' });
    }
    const result = await client.query(
      `INSERT INTO chat_group_members(group_id,user_id,added_by,is_active)
       VALUES($1,$2,$3,TRUE)
       ON CONFLICT(group_id,user_id)
       DO UPDATE SET is_active=TRUE,added_by=EXCLUDED.added_by
       RETURNING *`,
      [groupId, userId, req.user.id]
    );
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'chat.member.added',
      entity: 'chat_group_members',
      entityId: result.rows[0].id,
      detail: { group_id: groupId, user_id: userId },
      after: result.rows[0],
      client,
    });
    await client.query('COMMIT');
    const payload = { ...result.rows[0], user: user.rows[0] };
    await emitToChatAudience(groupId, 'chat:member_added', payload);
    res.json({ success: true, member: payload });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: 'No se pudo agregar el miembro.' });
  } finally {
    client.release();
  }
});

router.delete('/groups/:id/members/:userId', adminOnly, async (req, res) => {
  const groupId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT * FROM chat_group_members WHERE group_id=$1 AND user_id=$2 FOR UPDATE`,
      [groupId, userId]
    );
    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Miembro no encontrado.' });
    }
    const result = await client.query(
      `UPDATE chat_group_members SET is_active=FALSE WHERE group_id=$1 AND user_id=$2 RETURNING *`,
      [groupId, userId]
    );
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'chat.member.removed',
      entity: 'chat_group_members',
      entityId: result.rows[0].id,
      detail: { group_id: groupId, user_id: userId },
      before: before.rows[0],
      after: result.rows[0],
      client,
    });
    await client.query('COMMIT');
    const payload = { group_id: groupId, user_id: userId };
    emitToUser(userId, 'chat:member_removed', payload);
    await emitToChatAudience(groupId, 'chat:member_removed', payload);
    res.json({ success: true, member: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: 'No se pudo quitar el miembro.' });
  } finally {
    client.release();
  }
});

router.get('/groups/:id/messages', async (req, res) => {
  const groupId = Number(req.params.id);
  const access = await groupAccess(req.user, groupId);
  if (!access.group) return res.status(404).json({ success: false, error: 'Grupo no encontrado.' });
  if (!access.allowed) return res.status(403).json({ success: false, error: 'No perteneces a este grupo.' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const params = [groupId, limit];
  const beforeSql = req.query.beforeId
    ? (params.push(Number(req.query.beforeId)), `AND m.id<$${params.length}`)
    : '';
  const result = await pool.query(
    `SELECT m.id,m.group_id,m.sender_id,m.message,m.created_at,m.edited_at,
            u.username,u.full_name AS sender_name,
            CASE u.role WHEN 'tecnico' THEN 'tech' WHEN 'asociado' THEN 'associate' ELSE u.role END AS sender_role
     FROM chat_messages m
     JOIN app_users u ON u.id=m.sender_id
     WHERE m.group_id=$1 ${beforeSql}
     ORDER BY m.id DESC LIMIT $2`,
    params
  );
  res.json({ success: true, messages: result.rows.reverse() });
});

router.post('/groups/:id/messages', async (req, res) => {
  const groupId = Number(req.params.id);
  const validation = validateChatMessage(req.body.message);
  if (validation.error) return res.status(400).json({ success: false, error: validation.error });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const access = await groupAccess(req.user, groupId, client);
    if (!access.group) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Grupo no encontrado.' });
    }
    if (!access.allowed) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, error: 'No perteneces a este grupo.' });
    }
    if (!access.group.is_active) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'El grupo está cerrado.' });
    }
    const result = await client.query(
      `INSERT INTO chat_messages(group_id,sender_id,message)
       VALUES($1,$2,$3)
       RETURNING *`,
      [groupId, req.user.id, validation.value]
    );
    await client.query(`UPDATE chat_groups SET updated_at=NOW() WHERE id=$1`, [groupId]);
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'chat.message.created',
      entity: 'chat_messages',
      entityId: result.rows[0].id,
      detail: { group_id: groupId },
      after: result.rows[0],
      client,
    });
    await client.query('COMMIT');
    const payload = {
      ...result.rows[0],
      sender_name: req.user.name,
      sender_role: req.user.role,
    };
    await emitToChatAudience(groupId, 'chat:message_created', payload);
    res.status(201).json({ success: true, message: payload });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: 'No se pudo enviar el mensaje.' });
  } finally {
    client.release();
  }
});

module.exports = router;
