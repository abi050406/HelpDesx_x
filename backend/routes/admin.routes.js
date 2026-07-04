const express = require('express');
const pool = require('../db');
const { requireAuth, hashPassword, normalizeUsername } = require('./auth.routes');
const {
  assignTicket,
  WAITING_KEY,
  processWaitingQueue,
  reprocessUnassignedTickets,
  assignmentDecision,
  repairDuplicateHighPriorityAssignments,
} = require('../services/assignment.service');
const { listTechnicianPresence } = require('../services/presence.service');
const { emitToUser } = require('../services/realtime.service');
const { logAudit } = require('../services/audit.service');
const { client: redisClient } = require('../redis');
const { recordStatusChange } = require('../services/statusHistory.service');
const { createNotification } = require('../services/notification.service');
const { listRatings, listTicketRatings } = require('../services/rating.service');
const { normalizeFullName, usernameBase, validateCreateUser, deactivationError, duplicateUserCode } = require('../domain/adminUsers');
const { idempotency } = require('../middleware/idempotency');
const { planTicketRepairs } = require('../domain/ticketRepair');
const { TICKET_STATES, assertTransition } = require('../domain/ticketState');
const { requirePasswordChangeForUser } = require('../services/session.service');
const { validateManualAssignment } = require('../domain/manualAssignment');

const router = express.Router();
router.use((req, _res, next) => {
  req.adminRoute = true;
  next();
});
router.use(requireAuth, (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol administrador.' }));

function cleanText(value) {
  return String(value || '').trim();
}

function categoryValues(body) {
  return {
    name: cleanText(body.nombre_categoria ?? body.categoria ?? body.name),
    description: cleanText(body.descripcion ?? body.description) || null,
    sla: Number(body.tiempo_sla_minutos ?? body.slaMinutes ?? 60),
    low: Number(body.prioridad_baja_min ?? 0),
    medium: Number(body.prioridad_media_min ?? 3),
    high: Number(body.prioridad_alta_min ?? 7),
    critical: Number(body.prioridad_critica_min ?? 10),
    color: cleanText(body.color) || null,
    icon: cleanText(body.icono ?? body.icon) || null,
    active: body.is_active ?? body.active,
  };
}

async function saveTechnicianAssignments({ categoryId, assignments, actor }) {
  if (!categoryId || !Array.isArray(assignments) || !assignments.length) {
    const error = new Error('Categoría y asignaciones son obligatorias.');
    error.status = 400;
    throw error;
  }
  const category = await pool.query(
    `SELECT id,nombre_categoria FROM configuracion_categorias WHERE id=$1 AND is_active=TRUE`,
    [categoryId]
  );
  if (!category.rows[0]) {
    const error = new Error('Categoría no encontrada o inactiva.');
    error.status = 404;
    throw error;
  }

  const clientDb = await pool.connect();
  try {
    await clientDb.query('BEGIN');
    const saved = [];
    for (const item of assignments) {
      const technicianId = Number(item.technicianId ?? item.technician_id);
      const priority = Number(item.priority || item.skillPriority || item.prioridad_skill || 3);
      const excluded = Boolean(item.excluded ?? item.excluido);
      const responsibility = String(item.responsibility || item.descripcion_responsabilidad || '').trim() || null;
      if (!technicianId || priority < 1 || priority > 99) {
        const error = new Error('Cada asignación requiere técnico y prioridad entre 1 y 99.');
        error.status = 400;
        throw error;
      }
      const tech = await clientDb.query(
        `SELECT id FROM app_users WHERE id=$1 AND role='tecnico' AND is_active=TRUE`,
        [technicianId]
      );
      if (!tech.rows[0]) {
        const error = new Error(`Técnico inválido o inactivo: ${technicianId}`);
        error.status = 400;
        throw error;
      }
      const result = await clientDb.query(
        `INSERT INTO tecnico_categoria_config(
           tecnico_id,categoria_id,excluido,prioridad_skill,descripcion_responsabilidad
         ) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(tecnico_id,categoria_id)
         DO UPDATE SET excluido=EXCLUDED.excluido,
                       prioridad_skill=EXCLUDED.prioridad_skill,
                       descripcion_responsabilidad=EXCLUDED.descripcion_responsabilidad,
                       updated_at=NOW()
         RETURNING *`,
        [technicianId, categoryId, excluded, priority, responsibility]
      );
      saved.push(result.rows[0]);
    }
    await logAudit({
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      action: 'matriz_asignacion.actualizar',
      entity: 'tecnico_categoria_config',
      entityId: categoryId,
      detail: { category: category.rows[0].nombre_categoria, assignments: saved },
      after: saved,
      client: clientDb,
    });
    await clientDb.query('COMMIT');
    const reprocessed = await reprocessUnassignedTickets({ categoryId });
    return { category: category.rows[0], assignments: saved, reprocessed };
  } catch (error) {
    await clientDb.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    clientDb.release();
  }
}

router.get('/categories', async (_req, res) => {
  try {
    const [categories, tags, questions, options] = await Promise.all([
      pool.query(`SELECT id,nombre_categoria,descripcion,tiempo_sla_minutos,
                         prioridad_baja_min,prioridad_media_min,prioridad_alta_min,prioridad_critica_min,
                         color,icono,is_active,created_at,updated_at
                  FROM configuracion_categorias ORDER BY nombre_categoria`),
      pool.query(`SELECT id,categoria_id,nombre,descripcion,is_active,sort_order,created_at
                  FROM etiquetas_categoria ORDER BY categoria_id,sort_order,nombre`),
      pool.query(`SELECT id,categoria_id,pregunta,is_required,is_active,sort_order,created_at
                  FROM preguntas_contexto ORDER BY categoria_id,sort_order,id`),
      pool.query(`SELECT id,pregunta_id,texto AS nombre,texto,puntaje,sort_order,is_active
                  FROM opciones_pregunta ORDER BY pregunta_id,sort_order,id`),
    ]);
    const optionMap = new Map();
    for (const option of options.rows) {
      if (!optionMap.has(option.pregunta_id)) optionMap.set(option.pregunta_id, []);
      optionMap.get(option.pregunta_id).push(option);
    }
    const questionMap = new Map();
    for (const question of questions.rows) {
      if (!questionMap.has(question.categoria_id)) questionMap.set(question.categoria_id, []);
      questionMap.get(question.categoria_id).push({ ...question, opciones: optionMap.get(question.id) || [] });
    }
    const tagMap = new Map();
    for (const tag of tags.rows) {
      if (!tagMap.has(tag.categoria_id)) tagMap.set(tag.categoria_id, []);
      tagMap.get(tag.categoria_id).push(tag);
    }
    res.json(categories.rows.map((category) => ({
      ...category,
      sla: {
        tiempo_sla_minutos: category.tiempo_sla_minutos,
        prioridad_baja_min: category.prioridad_baja_min,
        prioridad_media_min: category.prioridad_media_min,
        prioridad_alta_min: category.prioridad_alta_min,
        prioridad_critica_min: category.prioridad_critica_min,
      },
      etiquetas: tagMap.get(category.id) || [],
      preguntas: questionMap.get(category.id) || [],
      preguntas_contexto: questionMap.get(category.id) || [],
    })));
  } catch (error) {
    console.error('Error consultando categorías administrativas:', error.message);
    res.status(500).json({ error: 'No se pudieron consultar las categorías.' });
  }
});

router.post('/categories', async (req, res) => {
  const value = categoryValues(req.body);
  if (!value.name || value.name.length > 100 || !Number.isInteger(value.sla) || value.sla <= 0) {
    return res.status(400).json({ error: 'Nombre y SLA positivo son obligatorios.' });
  }
  if (!(value.low <= value.medium && value.medium <= value.high && value.high <= value.critical)) {
    return res.status(400).json({ error: 'Los umbrales de prioridad deben estar en orden ascendente.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO configuracion_categorias(
         nombre_categoria,descripcion,tiempo_sla_minutos,prioridad_baja_min,
         prioridad_media_min,prioridad_alta_min,prioridad_critica_min,color,icono,is_active
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [value.name,value.description,value.sla,value.low,value.medium,value.high,value.critical,value.color,value.icon,value.active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'La categoría ya existe.' : 'No se pudo crear la categoría.' });
  }
});

router.put('/categories/:id', async (req, res) => {
  const value = categoryValues(req.body);
  if (!value.name || value.name.length > 100 || !Number.isInteger(value.sla) || value.sla <= 0) {
    return res.status(400).json({ error: 'Nombre y SLA positivo son obligatorios.' });
  }
  if (!(value.low <= value.medium && value.medium <= value.high && value.high <= value.critical)) {
    return res.status(400).json({ error: 'Los umbrales de prioridad deben estar en orden ascendente.' });
  }
  try {
    const result = await pool.query(
      `UPDATE configuracion_categorias SET nombre_categoria=$1,descripcion=$2,tiempo_sla_minutos=$3,
         prioridad_baja_min=$4,prioridad_media_min=$5,prioridad_alta_min=$6,prioridad_critica_min=$7,
         color=$8,icono=$9,is_active=COALESCE($10,is_active),updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [value.name,value.description,value.sla,value.low,value.medium,value.high,value.critical,value.color,value.icon,
       value.active === undefined ? null : Boolean(value.active),Number(req.params.id)]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Categoría no encontrada.' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'La categoría ya existe.' : 'No se pudo editar la categoría.' });
  }
});

router.post('/categories/:id/tags', async (req, res) => {
  const name = cleanText(req.body.nombre ?? req.body.nombre_etiqueta);
  if (!name || name.length > 120) return res.status(400).json({ error: 'El nombre de la etiqueta es obligatorio.' });
  try {
    const result = await pool.query(
      `INSERT INTO etiquetas_categoria(categoria_id,nombre,descripcion,is_active,sort_order)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [Number(req.params.id),name,cleanText(req.body.descripcion) || null,req.body.is_active !== false,Number(req.body.sort_order || 0)]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    const status = error.code === '23503' ? 404 : error.code === '23505' ? 409 : 500;
    res.status(status).json({ error: status === 404 ? 'Categoría no encontrada.' : status === 409 ? 'La etiqueta ya existe.' : 'No se pudo crear la etiqueta.' });
  }
});

router.put('/tags/:id', async (req, res) => {
  const name = cleanText(req.body.nombre ?? req.body.nombre_etiqueta);
  if (!name || name.length > 120) return res.status(400).json({ error: 'El nombre de la etiqueta es obligatorio.' });
  try {
    const result = await pool.query(
      `UPDATE etiquetas_categoria SET nombre=$1,descripcion=$2,is_active=$3,sort_order=$4 WHERE id=$5 RETURNING *`,
      [name,cleanText(req.body.descripcion) || null,req.body.is_active !== false,Number(req.body.sort_order || 0),Number(req.params.id)]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Etiqueta no encontrada.' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'La etiqueta ya existe.' : 'No se pudo editar la etiqueta.' });
  }
});

router.post('/categories/:id/questions', async (req, res) => {
  const question = cleanText(req.body.pregunta);
  if (!question) return res.status(400).json({ error: 'La pregunta es obligatoria.' });
  try {
    const result = await pool.query(
      `INSERT INTO preguntas_contexto(categoria_id,pregunta,is_required,is_active,sort_order)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [Number(req.params.id),question,req.body.is_required !== false,req.body.is_active !== false,Number(req.body.sort_order || 0)]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(error.code === '23503' ? 404 : 500).json({ error: error.code === '23503' ? 'Categoría no encontrada.' : 'No se pudo crear la pregunta.' });
  }
});

router.put('/questions/:id', async (req, res) => {
  const question = cleanText(req.body.pregunta);
  if (!question) return res.status(400).json({ error: 'La pregunta es obligatoria.' });
  const result = await pool.query(
    `UPDATE preguntas_contexto SET pregunta=$1,is_required=$2,is_active=$3,sort_order=$4 WHERE id=$5 RETURNING *`,
    [question,req.body.is_required !== false,req.body.is_active !== false,Number(req.body.sort_order || 0),Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Pregunta no encontrada.' });
  res.json(result.rows[0]);
});

router.post('/questions/:id/options', async (req, res) => {
  const text = cleanText(req.body.texto ?? req.body.nombre);
  const score = Number(req.body.puntaje ?? 0);
  if (!text || text.length > 160 || !Number.isInteger(score)) return res.status(400).json({ error: 'Texto y puntaje entero son obligatorios.' });
  try {
    const result = await pool.query(
      `INSERT INTO opciones_pregunta(pregunta_id,texto,puntaje,sort_order,is_active)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [Number(req.params.id),text,score,Number(req.body.sort_order || 0),req.body.is_active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(error.code === '23503' ? 404 : 500).json({ error: error.code === '23503' ? 'Pregunta no encontrada.' : 'No se pudo crear la opción.' });
  }
});

router.put('/question-options/:id', async (req, res) => {
  const text = cleanText(req.body.texto ?? req.body.nombre);
  const score = Number(req.body.puntaje ?? 0);
  if (!text || text.length > 160 || !Number.isInteger(score)) return res.status(400).json({ error: 'Texto y puntaje entero son obligatorios.' });
  const result = await pool.query(
    `UPDATE opciones_pregunta SET texto=$1,puntaje=$2,sort_order=$3,is_active=$4 WHERE id=$5 RETURNING *`,
    [text,score,Number(req.body.sort_order || 0),req.body.is_active !== false,Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Opción no encontrada.' });
  res.json(result.rows[0]);
});

router.post('/categories/:id/toggle', async (req, res) => {
  const result = await pool.query(
    `UPDATE configuracion_categorias SET is_active=NOT is_active,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Categoría no encontrada.' });
  res.json(result.rows[0]);
});

async function adminUsers(query = {}) {
  const params = [];
  const where = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (query.search) {
    params.push(cleanText(query.search));
    where.push(`(u.username ILIKE '%' || $${params.length} || '%' OR u.full_name ILIKE '%' || $${params.length} || '%')`);
  }
  const roleMap = { admin: 'admin', tech: 'tecnico', associate: 'asociado' };
  if (query.role && roleMap[query.role]) add('u.role=?', roleMap[query.role]);
  if (query.department) add('u.department=?', cleanText(query.department));
  if (query.active === 'true' || query.active === 'false') add('u.is_active=?', query.active === 'true');
  const result = await pool.query(
    `SELECT u.id,u.username,u.full_name,
            CASE u.role WHEN 'tecnico' THEN 'tech' WHEN 'asociado' THEN 'associate' ELSE u.role END AS role,
            u.role AS database_role,u.role_label,u.department,u.avatar,u.is_active,u.must_change_password,
            u.created_at,u.updated_at,u.deleted_at,
            tech.avg_rating AS avg_rating_as_technician,
            assoc.avg_rating AS avg_rating_as_associate,
            COALESCE(tech.ratings_count,0)::int AS ratings_count_as_technician,
            COALESCE(assoc.ratings_count,0)::int AS ratings_count_as_associate
     FROM app_users u
     LEFT JOIN (
       SELECT rated_user_id,AVG(stars)::numeric(3,2) AS avg_rating,COUNT(*)::int AS ratings_count
       FROM ticket_ratings WHERE rating_type='associate_to_technician' GROUP BY rated_user_id
     ) tech ON tech.rated_user_id=u.id
     LEFT JOIN (
       SELECT rated_user_id,AVG(stars)::numeric(3,2) AS avg_rating,COUNT(*)::int AS ratings_count
       FROM ticket_ratings WHERE rating_type='technician_to_associate' GROUP BY rated_user_id
     ) assoc ON assoc.rated_user_id=u.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY u.is_active DESC,u.full_name`,
    params
  );
  const presence = await listTechnicianPresence();
  const presenceById = new Map(presence.map((item) => [Number(item.tecnico_id), item]));
  return result.rows.map((user) => ({
    ...user,
    avg_rating_as_technician: user.avg_rating_as_technician === null ? null : Number(user.avg_rating_as_technician),
    avg_rating_as_associate: user.avg_rating_as_associate === null ? null : Number(user.avg_rating_as_associate),
    presence: user.role === 'tech' ? presenceById.get(Number(user.id)) || null : null,
  }));
}

router.get('/users/suggest-username', async (req, res) => {
  const base = usernameBase(req.query.fullName);
  if (!base) return res.status(400).json({ success: false, error: 'fullName es obligatorio.' });
  const result = await pool.query(`SELECT username FROM app_users WHERE username=$1 OR username ~ $2`, [base,`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[0-9]+$`]);
  const used = new Set(result.rows.map((item) => item.username));
  let username = base;
  let suffix = 2;
  while (used.has(username)) username = `${base}${suffix++}`;
  res.json({ success: true, username });
});

router.get('/users', async (req, res) => {
  try {
    res.json({ success: true, users: await adminUsers(req.query) });
  } catch (error) {
    console.error('Error listando usuarios:', error.message);
    res.status(500).json({ success: false, error: 'No se pudieron consultar los usuarios.' });
  }
});

router.post('/users', async (req, res) => {
  const validationError = validateCreateUser(req.body);
  if (validationError) return res.status(400).json({ success: false, error: validationError });
  const username = normalizeUsername(req.body.username);
  const fullName = cleanText(req.body.full_name).replace(/\s+/g, ' ');
  const roleMap = { admin: 'admin', tech: 'tecnico', associate: 'asociado' };
  const databaseRole = roleMap[req.body.role];
  try {
    const [usernameDuplicate, fullNameDuplicate] = await Promise.all([
      pool.query(`SELECT id FROM app_users WHERE username=$1 LIMIT 1`, [username]),
      pool.query(
        `SELECT id FROM app_users
         WHERE is_active=TRUE AND regexp_replace(lower(trim(full_name)), '\\s+', ' ', 'g')=$1 LIMIT 1`,
        [normalizeFullName(fullName)]
      ),
    ]);
    const duplicateCode = duplicateUserCode(Boolean(usernameDuplicate.rows[0]), Boolean(fullNameDuplicate.rows[0]));
    if (duplicateCode === 'USERNAME_EXISTS') {
      return res.status(409).json({ success: false, code: 'USERNAME_EXISTS', error: 'Ya existe un usuario con ese nombre de usuario.' });
    }
    if (duplicateCode === 'FULL_NAME_EXISTS') {
      return res.status(409).json({ success: false, code: 'FULL_NAME_EXISTS', error: 'Ya existe un usuario con ese nombre completo.' });
    }
    const result = await pool.query(
      `INSERT INTO app_users(username,password_hash,full_name,role,role_label,department,is_active,must_change_password)
       VALUES($1,$2,$3,$4,$5,$6,TRUE,TRUE)
       RETURNING id,username,full_name,role_label,department,avatar,is_active,must_change_password,created_at`,
      [username,hashPassword(req.body.password),fullName,databaseRole,cleanText(req.body.role_label),cleanText(req.body.department)]
    );
    const created = { ...result.rows[0], role: req.body.role, database_role: databaseRole };
    res.status(201).json({ success: true, ...created, user: created });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, code: 'USERNAME_EXISTS', error: 'Ya existe un usuario con ese nombre de usuario.' });
    }
    res.status(500).json({ success: false, error: 'No se pudo crear el usuario.' });
  }
});

async function changeUserActive(req, res, softDelete) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: 'Usuario inválido.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [targetResult, adminCountResult] = await Promise.all([
      client.query(`SELECT id,role,is_active FROM app_users WHERE id=$1 FOR UPDATE`, [id]),
      client.query(`SELECT COUNT(*)::int AS total FROM app_users WHERE role='admin' AND is_active=TRUE`),
    ]);
    const target = targetResult.rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }
    const willDeactivate = softDelete || target.is_active;
    if (willDeactivate) {
      const ruleError = deactivationError({
        targetId: id,
        actorId: req.user.id,
        targetRole: target.role,
        activeAdminCount: adminCountResult.rows[0].total,
      });
      if (ruleError) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, ...ruleError });
      }
    }
    const result = await client.query(
      softDelete
        ? `UPDATE app_users SET is_active=FALSE,deleted_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING id,is_active,deleted_at`
        : `UPDATE app_users SET is_active=NOT is_active,deleted_at=CASE WHEN is_active THEN deleted_at ELSE NULL END,updated_at=NOW()
           WHERE id=$1 RETURNING id,is_active,deleted_at`,
      [id]
    );
    await client.query('COMMIT');
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: 'No se pudo actualizar el usuario.' });
  } finally {
    client.release();
  }
}

router.delete('/users/:id', (req, res) => changeUserActive(req, res, true));
router.post('/users/:id/toggle', (req, res) => changeUserActive(req, res, false));

router.post('/users/:id/reset-password', idempotency, async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 8 caracteres.' });
  const before = await pool.query(
    `SELECT id,username,role,is_active,must_change_password,updated_at FROM app_users WHERE id=$1`,
    [Number(req.params.id)]
  );
  const result = await pool.query(
    `UPDATE app_users SET password_hash=$1,must_change_password=TRUE,updated_at=NOW()
     WHERE id=$2 RETURNING id,username,role,is_active,must_change_password,updated_at`,
    [hashPassword(password),Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
  await requirePasswordChangeForUser(Number(req.params.id));
  await logAudit({
    actorId: req.user.id,
    actorUsername: req.user.username,
    actorRole: req.user.role,
    action: 'user.reset_password',
    entity: 'app_users',
    entityId: Number(req.params.id),
    detail: { password_hash_redacted: true },
    before: before.rows[0],
    after: result.rows[0],
  });
  res.json({ success: true });
});

router.get('/departments', async (_req, res) => {
  const result = await pool.query(`SELECT code,name FROM departments WHERE is_active=TRUE ORDER BY sort_order,name`);
  res.json(result.rows);
});

router.get('/dashboard', async (_req, res) => {
  try {
    const [summary, byCategory, byTechnician, byAssociate, averages, latestTickets, latestRatings, technicians, presence] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS "totalTickets",
        COUNT(*) FILTER(WHERE estado='Abierto')::int AS "ticketsAbiertos",
        COUNT(*) FILTER(WHERE estado='En Progreso')::int AS "ticketsEnProgreso",
        COUNT(*) FILTER(WHERE estado='Planificado')::int AS "ticketsPlanificados",
        COUNT(*) FILTER(WHERE estado='En Espera')::int AS "ticketsEnEspera",
        COUNT(*) FILTER(WHERE estado IN ('Resuelto','Cerrado'))::int AS "ticketsResueltos" FROM tickets`),
      pool.query(`SELECT COALESCE(c.nombre_categoria,t.categoria) AS categoria,COUNT(*)::int AS total
                  FROM tickets t LEFT JOIN configuracion_categorias c ON c.id=t.categoria_id
                  GROUP BY COALESCE(c.nombre_categoria,t.categoria) ORDER BY total DESC`),
      pool.query(`SELECT u.id,u.full_name AS tecnico,COUNT(t.id)::int AS total
                  FROM app_users u LEFT JOIN tickets t ON t.tecnico_id=u.id
                  WHERE u.role='tecnico' GROUP BY u.id ORDER BY total DESC,u.full_name`),
      pool.query(`SELECT u.id,u.full_name AS asociado,COUNT(t.id)::int AS total
                  FROM app_users u LEFT JOIN tickets t ON t.usuario_id=u.id
                  WHERE u.role='asociado' GROUP BY u.id ORDER BY total DESC,u.full_name`),
      pool.query(`SELECT
        COALESCE(AVG(stars) FILTER(WHERE rating_type='associate_to_technician'),0)::numeric(3,2) AS "promedioCalificacionTecnicos",
        COALESCE(AVG(stars) FILTER(WHERE rating_type='technician_to_associate'),0)::numeric(3,2) AS "promedioCalificacionAsociados"
        FROM ticket_ratings`),
      pool.query(`SELECT t.id,t.titulo,t.titulo_tecnico,t.estado,t.prioridad,t.categoria,t.created_at,
                         a.full_name AS asociado,te.full_name AS tecnico
                  FROM tickets t LEFT JOIN app_users a ON a.id=t.usuario_id LEFT JOIN app_users te ON te.id=t.tecnico_id
                  ORDER BY t.created_at DESC LIMIT 10`),
      pool.query(`SELECT r.*,t.categoria FROM ticket_ratings r JOIN tickets t ON t.id=r.ticket_id ORDER BY r.created_at DESC LIMIT 10`),
      pool.query(`SELECT id FROM app_users WHERE role='tecnico' AND is_active=TRUE`),
      listTechnicianPresence(),
    ]);
    const presenceById = new Map(presence.map((item) => [Number(item.tecnico_id), item.estado]));
    const technicianPresence = { activos: 0, fuera: 0, break: 0 };
    for (const technician of technicians.rows) {
      const state = presenceById.get(Number(technician.id)) || 'Fuera de Servicio';
      if (state === 'Activo' || state === 'Ocupado') technicianPresence.activos += 1;
      else if (state === 'En Break') technicianPresence.break += 1;
      else technicianPresence.fuera += 1;
    }
    res.json({
      ...summary.rows[0],
      ticketsPorCategoria: byCategory.rows,
      ticketsPorTecnico: byTechnician.rows,
      ticketsPorAsociado: byAssociate.rows,
      ...averages.rows[0],
      tecnicos: technicianPresence,
      tecnicosActivos: technicianPresence.activos,
      tecnicosFuera: technicianPresence.fuera,
      tecnicosBreak: technicianPresence.break,
      ultimosTickets: latestTickets.rows,
      ultimosRatings: latestRatings.rows,
    });
  } catch (error) {
    console.error('Error consultando dashboard administrativo:', error.message);
    res.status(500).json({ error: 'No se pudo consultar el dashboard.' });
  }
});

router.get('/assignment-rules', async (_req, res) => {
  const [skills, conflicts] = await Promise.all([
    pool.query(`SELECT cfg.*,u.full_name tecnico,c.nombre_categoria FROM tecnico_categoria_config cfg JOIN app_users u ON u.id=cfg.tecnico_id JOIN configuracion_categorias c ON c.id=cfg.categoria_id ORDER BY u.full_name,c.nombre_categoria`),
    pool.query(`SELECT x.*,a.full_name asociado,t.full_name tecnico FROM conflictos_atencion x JOIN app_users a ON a.id=x.asociado_id JOIN app_users t ON t.id=x.tecnico_id ORDER BY a.full_name,t.full_name`),
  ]);
  res.json({ skills: skills.rows, conflicts: conflicts.rows });
});

router.get('/assignment-dashboard', async (_req, res) => {
  const [technicians, categories, rules, conflicts, ticketLoad, waitingCount, presence] = await Promise.all([
    pool.query(`
      SELECT id, username, full_name, department, avatar, exclusion_corporativa, is_active
      FROM app_users
      WHERE role='tecnico'
      ORDER BY full_name
    `),
    pool.query(`
      SELECT id, nombre_categoria, tiempo_sla_minutos, is_active, is_active AS activo
      FROM configuracion_categorias
      WHERE is_active=TRUE
      ORDER BY nombre_categoria
    `),
    pool.query(`
      SELECT cfg.*, u.full_name tecnico, c.nombre_categoria
      FROM tecnico_categoria_config cfg
      JOIN app_users u ON u.id=cfg.tecnico_id
      JOIN configuracion_categorias c ON c.id=cfg.categoria_id
      WHERE u.role='tecnico' AND c.is_active=TRUE
      ORDER BY c.nombre_categoria, cfg.excluido ASC, cfg.prioridad_skill ASC, u.full_name
    `),
    pool.query(`
      SELECT x.*, a.full_name asociado, t.full_name tecnico
      FROM conflictos_atencion x
      JOIN app_users a ON a.id=x.asociado_id
      JOIN app_users t ON t.id=x.tecnico_id
      WHERE x.activo=TRUE
      ORDER BY a.full_name,t.full_name
    `),
    pool.query(`
      SELECT tecnico_id, categoria_id, estado, COUNT(*)::int total
      FROM tickets
      WHERE tecnico_id IS NOT NULL AND LOWER(estado) NOT IN ('cerrado','resuelto')
      GROUP BY tecnico_id, categoria_id, estado
    `),
    redisClient.zCard(WAITING_KEY).catch(() => 0),
    listTechnicianPresence(),
  ]);

  const ruleRows = rules.rows.map((rule) => ({
    ...rule,
    prioridad_skill: Number(rule.prioridad_skill),
    responsable_principal: !rule.excluido && Number(rule.prioridad_skill) === 1,
  }));

  const categoriesWithOwners = categories.rows.map((category) => {
    const owners = ruleRows
      .filter((rule) => Number(rule.categoria_id) === Number(category.id) && !rule.excluido)
      .sort((a, b) => a.prioridad_skill - b.prioridad_skill || String(a.tecnico).localeCompare(String(b.tecnico)));
    return {
      ...category,
      responsables: owners,
      responsable_principal: owners[0] || null,
      sin_responsable: owners.length === 0,
    };
  });

  res.json({
    technicians: technicians.rows,
    categories: categoriesWithOwners,
    rules: ruleRows,
    conflicts: conflicts.rows,
    ticketLoad: ticketLoad.rows,
    presence,
    waitingQueue: { total: waitingCount },
  });
});

router.put('/assignment-matrix/:categoryId', async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const assignments = Array.isArray(req.body.assignments) ? req.body.assignments : [];
  try {
    res.json(await saveTechnicianAssignments({ categoryId, assignments, actor: req.user }));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'No se pudo actualizar la matriz de asignación.' });
  }
});

router.get('/assignment-preview', async (req, res) => {
  const categoryId = Number(req.query.categoryId);
  const associateId = req.query.associateId ? Number(req.query.associateId) : null;
  if (!categoryId) return res.status(400).json({ error: 'categoryId es obligatorio.' });

  const [presence, rows] = await Promise.all([
    listTechnicianPresence(),
    pool.query(`
      SELECT u.id,u.full_name,u.username,u.department,u.avatar,u.exclusion_corporativa,u.is_active,
             cfg.excluido,cfg.prioridad_skill,cfg.descripcion_responsabilidad,
             CASE WHEN $2::int IS NULL THEN FALSE ELSE EXISTS (
               SELECT 1 FROM conflictos_atencion c
               WHERE c.asociado_id=$2 AND c.tecnico_id=u.id AND c.activo=TRUE
             ) END AS tiene_conflicto
      FROM app_users u
      LEFT JOIN tecnico_categoria_config cfg ON cfg.tecnico_id=u.id AND cfg.categoria_id=$1
      WHERE u.role='tecnico'
      ORDER BY cfg.excluido ASC NULLS LAST, cfg.prioridad_skill ASC NULLS LAST, u.full_name
    `, [categoryId, associateId]),
  ]);

  const evaluated = rows.rows.map((tech) => {
    const currentPresence = presence.find((item) => Number(item.tecnico_id) === Number(tech.id));
    const reasons = [];
    if (!tech.is_active) reasons.push('Usuario inactivo');
    if (tech.exclusion_corporativa) reasons.push('Exclusión corporativa');
    if (!tech.prioridad_skill) reasons.push('Sin regla para la categoría');
    if (tech.excluido) reasons.push('Excluido de la categoría');
    if (tech.tiene_conflicto) reasons.push('Conflicto asociado-técnico');
    if (currentPresence?.estado !== 'Activo') reasons.push(`Presencia: ${currentPresence?.estado || 'Offline'}`);
    return {
      ...tech,
      presencia: currentPresence || null,
      elegible: reasons.length === 0,
      razones_exclusion: reasons,
    };
  });

  const eligible = evaluated
    .filter((tech) => tech.elegible)
    .sort((a, b) => Number(a.prioridad_skill) - Number(b.prioridad_skill)
      || String(a.presencia?.disponible_desde || a.presencia?.ultima_actividad || '').localeCompare(String(b.presencia?.disponible_desde || b.presencia?.ultima_actividad || '')));

  res.json({
    categoryId,
    associateId,
    wouldAssignTo: eligible[0] || null,
    candidates: evaluated,
  });
});

router.put('/assignment-rules', async (req, res) => {
  if (req.body.ruleType === 'conflict') {
    const result = await pool.query(`INSERT INTO conflictos_atencion(asociado_id,tecnico_id,motivo,activo) VALUES($1,$2,$3,$4) ON CONFLICT(asociado_id,tecnico_id) DO UPDATE SET motivo=EXCLUDED.motivo,activo=EXCLUDED.activo RETURNING *`, [req.body.associateId, req.body.technicianId, req.body.reason || 'Restricción administrativa', req.body.active !== false]);
    await logAudit({ actorId: req.user.id, action: 'regla.conflicto', entity: 'conflictos_atencion', detail: result.rows[0] });
    return res.json(result.rows[0]);
  }
  const { technicianId, categoryId, excluded = false, skillPriority = 3 } = req.body;
  const responsibility = String(req.body.responsibility || req.body.descripcion_responsabilidad || '').trim() || null;
  const result = await pool.query(`INSERT INTO tecnico_categoria_config(tecnico_id,categoria_id,excluido,prioridad_skill,descripcion_responsabilidad) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tecnico_id,categoria_id) DO UPDATE SET excluido=EXCLUDED.excluido,prioridad_skill=EXCLUDED.prioridad_skill,descripcion_responsabilidad=EXCLUDED.descripcion_responsabilidad,updated_at=NOW() RETURNING *`, [technicianId, categoryId, Boolean(excluded), Number(skillPriority), responsibility]);
  await logAudit({ actorId: req.user.id, action: 'regla.skill', entity: 'tecnico_categoria_config', detail: result.rows[0] });
  processWaitingQueue().catch((error) => console.error('Error reprocesando bolsa tras regla:', error.message));
  res.json(result.rows[0]);
});

router.get('/ratings', async (_req, res) => {
  try {
    res.json({ ratings: await listRatings() });
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron consultar las calificaciones.' });
  }
});

router.get('/ratings/technicians', async (_req, res) => {
  try {
    res.json({ ratings: await listRatings({ ratingType: 'associate_to_technician' }) });
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron consultar las calificaciones de técnicos.' });
  }
});

router.get('/ratings/associates', async (_req, res) => {
  try {
    res.json({ ratings: await listRatings({ ratingType: 'technician_to_associate' }) });
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron consultar las calificaciones de asociados.' });
  }
});

router.get('/tickets/:id/ratings', async (req, res) => {
  try {
    res.json({ ratings: await listTicketRatings(Number(req.params.id)) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'No se pudieron consultar las calificaciones del ticket.' });
  }
});

router.post('/tickets/:id/reassign', idempotency, async (req, res) => {
  try {
    const before = await pool.query(`SELECT id,estado,tecnico_id FROM tickets WHERE id=$1 LIMIT 1`, [Number(req.params.id)]);
    const result = await assignTicket(Number(req.params.id), { forcedTechnicianId: req.body.technicianId, assignedBy: req.user.id, detail: { reason: req.body.reason } });
    const ticket = result.ticket || before.rows[0];
    await recordStatusChange({
      ticketId: Number(req.params.id),
      fromStatus: before.rows[0]?.estado || ticket?.estado || 'Reasignación',
      toStatus: ticket?.estado || before.rows[0]?.estado || 'Reasignación',
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      reason: String(req.body.reason || '').trim() || 'Reasignación administrativa',
      metadata: { assigned_from: before.rows[0]?.tecnico_id || null, assigned_to: req.body.technicianId },
    });
    await logAudit({ actorId: req.user.id, action: 'ticket.reasignar', entity: 'tickets', entityId: Number(req.params.id), detail: { technicianId: req.body.technicianId, reason: req.body.reason } });
    res.json(result);
  }
  catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/technician-assignment', idempotency, async (req, res) => {
  const ticketId = Number(req.body.ticketId ?? req.body.ticket_id);
  const technicianId = Number(req.body.technicianId ?? req.body.technician_id);
  try {
    if (!ticketId) {
      let categoryId = Number(req.body.categoryId ?? req.body.category_id);
      if (!categoryId && req.body.category) {
        const category = await pool.query(
          `SELECT id FROM configuracion_categorias
           WHERE LOWER(nombre_categoria)=LOWER($1) AND is_active=TRUE`,
          [String(req.body.category).trim()]
        );
        categoryId = Number(category.rows[0]?.id);
      }
      const assignments = Array.isArray(req.body.assignments)
        ? req.body.assignments
        : technicianId ? [req.body] : [];
      const saved = await saveTechnicianAssignments({
        categoryId,
        assignments,
        actor: req.user,
      });
      return res.json({ success: true, ...saved });
    }
    if (!technicianId) {
      return res.status(400).json({ success: false, error: 'technicianId es obligatorio para asignación directa.' });
    }
    const before = await pool.query(`SELECT * FROM tickets WHERE id=$1`, [ticketId]);
    const result = await assignTicket(ticketId, {
      forcedTechnicianId: technicianId,
      assignedBy: req.user.id,
      detail: { reason: req.body.reason || 'Asignación administrativa' },
    });
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'ticket.technician_assignment',
      entity: 'tickets',
      entityId: ticketId,
      detail: { technicianId },
      before: before.rows[0] || null,
      after: result.ticket || null,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(409).json({ success: false, code: error.code || 'ASSIGNMENT_FAILED', error: error.message });
  }
});

router.post('/tickets/:id/assign', idempotency, async (req, res) => {
  const ticketId = Number(req.params.id);
  const technicianId = Number(req.body.tecnico_id ?? req.body.technicianId);
  const reason = String(req.body.reason || 'Asignación manual por administrador').trim();
  const clientDb = await pool.connect();
  try {
    await clientDb.query('BEGIN');
    const [ticketResult, technicianResult] = await Promise.all([
      clientDb.query(`SELECT * FROM tickets WHERE id=$1 FOR UPDATE`, [ticketId]),
      clientDb.query(`SELECT id,username,full_name,role,is_active FROM app_users WHERE id=$1`, [technicianId]),
    ]);
    if (!ticketResult.rows[0]) {
      await clientDb.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Ticket no encontrado.' });
    }
    const validation = validateManualAssignment({
      actorRole: req.user.role,
      technician: technicianResult.rows[0],
    });
    if (validation) {
      await clientDb.query('ROLLBACK');
      return res.status(400).json({ success: false, ...validation });
    }
    const before = ticketResult.rows[0];
    const updated = await clientDb.query(
      `UPDATE tickets
       SET tecnico_id=$1,tecnico_nombre=$2,asignacion_estado='Asignado',
           assignment_status='assigned',assignment_reason='Asignación manual',updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [technicianId, technicianResult.rows[0].full_name, ticketId]
    );
    const metadata = {
      selected_technician_id: technicianId,
      selected_technician_name: technicianResult.rows[0].full_name,
      assignment_reason: 'Asignación manual',
      admin_reason: reason,
    };
    await clientDb.query(
      `INSERT INTO historial_asignaciones(ticket_id,tecnico_id,asignado_por,tipo,detalle)
       VALUES($1,$2,$3,'Forzada',$4::jsonb)`,
      [ticketId, technicianId, req.user.id, JSON.stringify(metadata)]
    );
    await recordStatusChange({
      ticketId,
      fromStatus: before.estado,
      toStatus: before.estado,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      reason,
      metadata,
      client: clientDb,
    });
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'ticket.assign_manual',
      entity: 'tickets',
      entityId: ticketId,
      detail: metadata,
      before,
      after: updated.rows[0],
      client: clientDb,
    });
    await clientDb.query('COMMIT');
    await redisClient.zRem(WAITING_KEY, String(ticketId));
    emitToUser(technicianId, 'ticket:assigned', updated.rows[0]);
    res.json({ success: true, ticket: updated.rows[0] });
  } catch (error) {
    await clientDb.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: 'No se pudo asignar el ticket.' });
  } finally {
    clientDb.release();
  }
});

router.post('/tickets/:id/simulate-assignment', async (req, res) => {
  try {
    const decision = await assignmentDecision(Number(req.params.id));
    res.json({
      success: true,
      candidatos: decision.candidates,
      recomendado: decision.selected ? {
        tecnico_id: decision.selected.id,
        tecnico_nombre: decision.selected.full_name,
        prioridad_asignacion: decision.selected.prioridad_asignacion,
        carga_activa: decision.selected.active_load,
      } : null,
      assignment_reason: decision.assignmentReason,
    });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

router.post('/tickets/:id/close', async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'La justificación administrativa es obligatoria.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT * FROM tickets WHERE id=$1 FOR UPDATE`, [Number(req.params.id)]);
    if (!result.rows[0] || result.rows[0].estado !== TICKET_STATES.RESOLVED) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ticket resuelto no encontrado.' }); }
    const ticket = result.rows[0];
    await client.query(`INSERT INTO historial_calificaciones(ticket_id,tecnico_id,asociado_id,puntuacion,comentario_evidencia) VALUES($1,$2,$3,3,$4) ON CONFLICT(ticket_id,asociado_id) DO NOTHING`, [ticket.id,ticket.tecnico_id,ticket.usuario_id,`Cierre administrativo: ${reason}`]);
    assertTransition(ticket.estado, TICKET_STATES.CLOSED, { role: req.user.role });
    const closed = await client.query(
      `UPDATE tickets SET estado=$3,motivo_cierre_admin=$1,
              cerrado_en=COALESCE(cerrado_en,NOW()),fecha_cerrado=COALESCE(fecha_cerrado,NOW()),updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [reason,ticket.id,TICKET_STATES.CLOSED]
    );
    await recordStatusChange({
      ticketId: ticket.id,
      fromStatus: ticket.estado,
      toStatus: 'Cerrado',
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      reason,
      metadata: { admin_force_closed: true },
      client,
    });
    await createNotification({
      userId: ticket.usuario_id,
      ticketId: ticket.id,
      type: 'admin_force_closed',
      severity: 'warning',
      title: 'Ticket cerrado administrativamente',
      body: reason,
      payload: { ticketId: ticket.id, reason },
      client,
    });
    if (ticket.tecnico_id) {
      await createNotification({
        userId: ticket.tecnico_id,
        ticketId: ticket.id,
        type: 'admin_force_closed',
        severity: 'warning',
        title: 'Ticket cerrado por administración',
        body: reason,
        payload: { ticketId: ticket.id, reason },
        client,
      });
    }
    await logAudit({ actorId: req.user.id, action: 'ticket.cierre_admin', entity: 'tickets', entityId: ticket.id, detail: { reason } });
    await client.query('COMMIT');
    emitToUser(ticket.usuario_id,'ticket:closed',closed.rows[0]);
    reprocessUnassignedTickets().catch((reprocessError) =>
      console.error('Error reprocesando bolsa tras cierre administrativo:', reprocessError.message));
    res.json(closed.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ error: 'No se pudo cerrar el ticket.' }); }
  finally { client.release(); }
});

router.post('/tickets/repair-states', idempotency, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const candidates = await client.query(
      `SELECT t.*,u.is_active AS technician_is_active,
              EXISTS (
                SELECT 1 FROM ticket_ratings r
                WHERE r.ticket_id=t.id AND r.rating_type='technician_to_associate'
              ) AS has_technician_rating
       FROM tickets t
       LEFT JOIN app_users u ON u.id=t.tecnico_id
       WHERE (
         LOWER(REPLACE(t.estado,'_',' '))='en progreso'
         AND (t.fecha_resuelto IS NOT NULL OR t.t_resolucion IS NOT NULL OR EXISTS (
           SELECT 1 FROM ticket_ratings r
           WHERE r.ticket_id=t.id AND r.rating_type='technician_to_associate'
         ))
       ) OR (
         LOWER(t.estado)='resuelto' AND t.fecha_resuelto IS NULL
       ) OR (
         LOWER(t.estado)='cerrado' AND t.fecha_cerrado IS NULL
       ) OR (
         t.tecnico_id IS NOT NULL AND COALESCE(u.is_active,FALSE)=FALSE
       )
       FOR UPDATE OF t`
    );

    const repairedTickets = [];
    const waitingIds = [];
    for (const ticket of candidates.rows) {
      const { repairs, nextState, inactiveAssignment, terminal } = planTicketRepairs(ticket);

      const updated = await client.query(
        `UPDATE tickets
         SET estado=$2,
             fecha_resuelto=CASE WHEN $2='Resuelto' THEN COALESCE(fecha_resuelto,NOW()) ELSE fecha_resuelto END,
             t_resolucion=CASE WHEN $2='Resuelto' THEN COALESCE(t_resolucion,fecha_resuelto,NOW()) ELSE t_resolucion END,
             fecha_cerrado=CASE WHEN LOWER($2)='cerrado' THEN COALESCE(fecha_cerrado,cerrado_en,NOW()) ELSE fecha_cerrado END,
             tecnico_id=CASE WHEN $3 AND NOT $4 THEN NULL ELSE tecnico_id END,
             tecnico_nombre=CASE WHEN $3 AND NOT $4 THEN NULL ELSE tecnico_nombre END,
             asignacion_estado=CASE WHEN $3 AND NOT $4 THEN 'Bolsa de Espera' ELSE asignacion_estado END,
             revision_asignacion=CASE WHEN $3 AND $4 THEN 'Técnico asignado inactivo' ELSE revision_asignacion END,
             updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [ticket.id, nextState, Boolean(inactiveAssignment), terminal]
      );
      await logAudit({
        actorId: req.user.id,
        actorUsername: req.user.username,
        actorRole: req.user.role,
        action: 'ticket.repair_state',
        entity: 'tickets',
        entityId: ticket.id,
        detail: { repairs },
        before: ticket,
        after: updated.rows[0],
        client,
      });
      if (nextState !== ticket.estado) {
        await recordStatusChange({
          ticketId: ticket.id,
          fromStatus: ticket.estado,
          toStatus: nextState,
          actorId: req.user.id,
          actorName: req.user.name,
          actorRole: req.user.role,
          reason: 'Resolución sincronizada',
          metadata: { action: 'repair-states', repairs },
          client,
        });
      }
      if (inactiveAssignment && !terminal) waitingIds.push(ticket.id);
      repairedTickets.push({ id: ticket.id, repairs, ticket: updated.rows[0] });
    }

    await client.query('COMMIT');
    for (const ticketId of waitingIds) {
      await redisClient.zAdd(WAITING_KEY, [{ score: Date.now(), value: String(ticketId) }]);
    }
    const highPriorityRepairs = await repairDuplicateHighPriorityAssignments({
      assignedBy: req.user.id,
    });
    for (const repair of highPriorityRepairs) {
      await logAudit({
        actorId: req.user.id,
        actorUsername: req.user.username,
        actorRole: req.user.role,
        action: 'ticket.repair_high_priority_assignment',
        entity: 'tickets',
        entityId: repair.id,
        detail: {
          previous_technician_id: repair.previous_technician_id,
          assignment_reason: repair.reassignment.assignment_reason,
          selected_technician_id: repair.reassignment.ticket?.tecnico_id || null,
        },
        after: repair.reassignment.ticket || null,
      });
    }
    repairedTickets.push(...highPriorityRepairs);
    res.json({ success: true, repaired: repairedTickets.length, tickets: repairedTickets });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error reparando estados de tickets:', error);
    res.status(500).json({ success: false, error: 'No se pudieron reparar los estados.' });
  } finally {
    client.release();
  }
});

router.get('/audit', async (_req, res) => {
  const result = await pool.query(`
    SELECT * FROM (
      SELECT s.created_at AS timestamp,
             CONCAT(COALESCE(u.full_name, 'Sistema'), ' · ', s.accion, ' · ', s.entidad,
                    CASE WHEN s.entidad_id IS NOT NULL THEN CONCAT(' #', s.entidad_id) ELSE '' END) AS event
      FROM auditoria_sistema s
      LEFT JOIN app_users u ON u.id=s.actor_id
      UNION ALL
      SELECT h.created_at AS timestamp,
             CONCAT('Ticket #', h.ticket_id, ' · ', h.tipo,
                    CASE WHEN u.full_name IS NOT NULL THEN CONCAT(' · ', u.full_name) ELSE '' END) AS event
      FROM historial_asignaciones h
      LEFT JOIN app_users u ON u.id=h.tecnico_id
      UNION ALL
      SELECT p.inicio AS timestamp,
             CONCAT(u.full_name, ' cambió presencia a ', p.estado,
                    CASE WHEN p.razon IS NOT NULL THEN CONCAT(' · ', p.razon) ELSE '' END) AS event
      FROM historial_presencia p
      JOIN app_users u ON u.id=p.tecnico_id
    ) audit
    ORDER BY timestamp DESC
    LIMIT 100
  `);
  res.json(result.rows);
});

router.get('/directory', async (_req, res) => {
  const [users, ratings, presence, departments] = await Promise.all([
    adminUsers(),
    pool.query(`SELECT h.*,t.full_name tecnico,a.full_name asociado FROM historial_calificaciones h JOIN app_users t ON t.id=h.tecnico_id JOIN app_users a ON a.id=h.asociado_id ORDER BY h.created_at DESC LIMIT 200`),
    listTechnicianPresence(),
    pool.query(`SELECT code,name FROM departments WHERE is_active=TRUE ORDER BY sort_order,name`),
  ]);
  const compatibleUsers = users.map((user) => ({ ...user, api_role: user.role, role: user.database_role }));
  res.json({ users: compatibleUsers, presence, ratings: ratings.rows, departments: departments.rows });
});

module.exports = router;
