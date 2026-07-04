const express = require('express');
const pool = require('../db');
const { requireAuth } = require('./auth.routes');
const { associateBrake } = require('../middleware/associateBrake');
const { assignTicket, reprocessUnassignedTickets } = require('../services/assignment.service');
const { emitToUser, emitToRole } = require('../services/realtime.service');
const { logAudit } = require('../services/audit.service');
const { recordStatusChange, getTicketHistory } = require('../services/statusHistory.service');
const { createNotification } = require('../services/notification.service');
const { createTicketRating, listTicketRatings, validateComment, validateStars } = require('../services/rating.service');
const { idempotency } = require('../middleware/idempotency');
const { TICKET_STATES, normalizeTicketState: canonicalState, assertTransition } = require('../domain/ticketState');
const { ticketCreationConflict } = require('../domain/ticketCreationPolicy');

const router = express.Router();
let schemaReady = false;

async function loadCategoryRules(categoryName, queryable = pool) {
  const categoryResult = await queryable.query(
    `SELECT id,nombre_categoria,tiempo_sla_minutos,prioridad_baja_min,prioridad_media_min,
            prioridad_alta_min,prioridad_critica_min
     FROM configuracion_categorias WHERE nombre_categoria=$1 AND is_active=TRUE LIMIT 1`,
    [categoryName]
  );
  const category = categoryResult.rows[0];
  if (!category) return null;
  const [tags, questions] = await Promise.all([
    queryable.query(`SELECT id,nombre FROM etiquetas_categoria WHERE categoria_id=$1 AND is_active=TRUE`, [category.id]),
    queryable.query(
      `SELECT p.id,p.legacy_key,p.pregunta,p.is_required,
              COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'puntaje',o.puntaje))
                FILTER(WHERE o.id IS NOT NULL),'[]'::jsonb) AS opciones
       FROM preguntas_contexto p
       LEFT JOIN opciones_pregunta o ON o.pregunta_id=p.id AND o.is_active=TRUE
       WHERE p.categoria_id=$1 AND p.is_active=TRUE
       GROUP BY p.id ORDER BY p.sort_order,p.id`,
      [category.id]
    ),
  ]);
  return { ...category, tags: tags.rows, questions: questions.rows };
}

function scoreConfiguredCategory(config, rawAnswers = {}) {
  const answers = {};
  let score = 0;
  for (const question of config.questions) {
    const key = String(question.id);
    const supplied = rawAnswers[key] ?? (question.legacy_key ? rawAnswers[question.legacy_key] : undefined);
    if ((supplied === undefined || supplied === null || supplied === '') && !question.is_required) continue;
    const numeric = Number(supplied);
    const options = Array.isArray(question.opciones) ? question.opciones : [];
    const selected = options.find((option) => Number(option.puntaje) === numeric)
      || options.find((option) => Number(option.id) === numeric);
    if (!selected) throw new Error(`Respuesta inválida o ausente: ${question.legacy_key || question.id}.`);
    answers[question.legacy_key || key] = Number(selected.puntaje);
    score += Number(selected.puntaje);
  }
  const priority = score >= Number(config.prioridad_critica_min) ? 'Crítica'
    : score >= Number(config.prioridad_alta_min) ? 'Alta'
      : score >= Number(config.prioridad_media_min) ? 'Media' : 'Baja';
  return { priority, score, answers, slaMinutes: Number(config.tiempo_sla_minutos) };
}

async function ensureTicketsSchema() {
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      titulo VARCHAR(120) NOT NULL,
      descripcion TEXT NOT NULL DEFAULT '',
      usuario_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const statements = [
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS titulo_tecnico VARCHAR(220);`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS solicitante_nombre VARCHAR(140);`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS categoria VARCHAR(80) NOT NULL DEFAULT 'Software';`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS etiqueta VARCHAR(120);`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS prioridad VARCHAR(30) NOT NULL DEFAULT 'Media';`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS puntaje_prioridad INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS respuestas_contexto JSONB NOT NULL DEFAULT '{}'::jsonb;`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_objetivo_minutos INTEGER;`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS estado VARCHAR(50) NOT NULL DEFAULT 'Abierto';`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS diagnostico_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_cerrado TIMESTAMPTZ;`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS t_apertura TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tecnico_id INTEGER;`,
    `CREATE INDEX IF NOT EXISTS idx_tickets_usuario_id ON tickets(usuario_id);`,
    `CREATE INDEX IF NOT EXISTS idx_tickets_categoria_prioridad ON tickets(categoria, prioridad);`,
  ];

  for (const statement of statements) await pool.query(statement);
  schemaReady = true;
}

function normalizeMeaningfulText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validateMeaningfulText(value, fieldName, minLength) {
  const normalized = normalizeMeaningfulText(value);
  if (!normalized) return { error: `${fieldName} es obligatorio.` };
  if (normalized.length < minLength) return { error: `${fieldName} debe tener al menos ${minLength} caracteres reales.` };
  if (!/[a-záéíóúñ0-9]/i.test(normalized)) return { error: `${fieldName} debe contener texto válido.` };
  return { value: normalized };
}

const TICKET_DESCRIPTION_DETAIL_ERROR = 'Explique con más detalle su problema para que el equipo de TI pueda diagnosticarlo correctamente.';

function normalizeTicketState(state) {
  return String(canonicalState(state, { strict: false }) || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, '_');
}

function plannedTicketPayload(ticket) {
  return {
    id: ticket.id,
    estado: ticket.estado,
    categoria: ticket.categoria,
    titulo: ticket.titulo,
    fecha_planificada: ticket.fecha_planificada,
  };
}

async function hasActiveTicketForAssociate(userId, newCategory = '', queryable = pool) {
  const result = await queryable.query(
    `SELECT id,estado,categoria,titulo,descripcion,fecha_planificada,sla_objetivo_minutos
     FROM tickets
     WHERE usuario_id = $1
     ORDER BY updated_at DESC NULLS LAST, id DESC`,
    [Number(userId)]
  );

  const conflict = ticketCreationConflict(result.rows, newCategory);
  if (conflict?.code === 'ACTIVE_TICKET_EXISTS') {
    const active = conflict.ticket;
    return {
      code: 'ACTIVE_TICKET_EXISTS',
      error: 'Ya tienes un ticket en progreso. Debes esperar a que sea cerrado antes de crear uno nuevo.',
      activeTicket: {
        id: active.id,
        estado: active.estado,
        categoria: active.categoria,
        titulo: active.titulo,
        descripcion_breve: normalizeMeaningfulText(active.descripcion).slice(0, 120),
      },
    };
  }

  if (conflict?.code === 'PLANNED_SAME_CATEGORY_EXISTS') {
    const sameCategory = conflict.ticket;
    return {
      code: 'PLANNED_SAME_CATEGORY_EXISTS',
      error: 'Ya tienes un ticket de esta categoría planificado. No es necesario crear otro para el mismo problema.',
      activeTicket: plannedTicketPayload(sameCategory),
    };
  }

  if (conflict?.code === 'PLANNED_TIME_CONFLICT') {
    const timeConflict = conflict.ticket;
    return {
      code: 'PLANNED_TIME_CONFLICT',
      error: 'Ya tienes una atención planificada para este momento. Espera a que finalice o contacta a TI si es urgente.',
      activeTicket: plannedTicketPayload(timeConflict),
    };
  }

  return null;
}

router.use(requireAuth);
router.use(async (req, res, next) => {
  try {
    await ensureTicketsSchema();
    next();
  } catch (error) {
    console.error('Error preparando tickets:', error.message);
    res.status(500).json({ error: 'No se pudo preparar el módulo de tickets.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const params = [];
    let where = '';
    if (req.user.role === 'associate') {
      params.push(req.user.id);
      where = 'WHERE usuario_id = $1';
    } else if (req.user.role === 'tech') {
      params.push(req.user.id);
      where = 'WHERE tecnico_id = $1';
    }
    const result = await pool.query(`SELECT * FROM tickets ${where} ORDER BY id DESC;`, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error en GET /tickets:', error.message);
    res.status(500).json({ error: 'Error interno al obtener los tickets.' });
  }
});

router.get('/catalog', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id,c.nombre_categoria,c.nombre_categoria AS categoria,c.tiempo_sla_minutos,
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object('id',e.id,'nombre',e.nombre) ORDER BY e.sort_order,e.nombre)
               FROM etiquetas_categoria e WHERE e.categoria_id=c.id AND e.is_active=TRUE
             ),'[]'::jsonb) AS etiquetas,
             COALESCE((
               SELECT jsonb_agg(
                 jsonb_build_object(
                   'id',p.id,'pregunta',p.pregunta,'is_required',p.is_required,
                   'opciones',COALESCE((
                     SELECT jsonb_agg(jsonb_build_object('id',o.id,'nombre',o.texto,'puntaje',o.puntaje)
                                      ORDER BY o.sort_order,o.id)
                     FROM opciones_pregunta o WHERE o.pregunta_id=p.id AND o.is_active=TRUE
                   ),'[]'::jsonb)
                 ) ORDER BY p.sort_order,p.id
               )
               FROM preguntas_contexto p WHERE p.categoria_id=c.id AND p.is_active=TRUE
             ),'[]'::jsonb) AS preguntas_contexto
      FROM configuracion_categorias c
      WHERE c.is_active=TRUE
      ORDER BY c.nombre_categoria;
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo consultar el catálogo de categorías.' });
  }
});

router.post('/priority', async (req, res) => {
  try {
    const config = await loadCategoryRules(String(req.body.categoria || '').trim());
    if (!config) throw new Error('Categoría no válida.');
    res.json(scoreConfiguredCategory(config, req.body.respuestas_contexto));
  }
  catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/', idempotency, associateBrake, async (req, res) => {
  if (req.user.role !== 'associate') {
    return res.status(403).json({ success: false, error: 'Solo el asociado puede crear tickets.' });
  }
  const category = String(req.body.categoria || '').trim();
  const tag = String(req.body.etiqueta || '').trim();
  const descriptionValidation = validateMeaningfulText(req.body.descripcion, 'La descripción del ticket', 25);
  if (!category) return res.status(400).json({ error: 'La categoría es obligatoria.' });
  if (descriptionValidation.error) return res.status(400).json({ error: TICKET_DESCRIPTION_DETAIL_ERROR });

  let config;
  let scoring;
  try {
    config = await loadCategoryRules(category);
    if (!config) return res.status(400).json({ error: 'Selecciona una categoría válida.' });
    if (!config.tags.some((item) => item.nombre === tag)) {
      return res.status(400).json({ error: 'La etiqueta no pertenece a la categoría seleccionada.' });
    }
    scoring = scoreConfiguredCategory(config, req.body.respuestas_contexto);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const associateName = req.user.name || req.user.username;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    if (req.user.role === 'associate' || req.user.role === 'asociado') {
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [20260626, Number(req.user.id)]);
      const activeTicketBlock = await hasActiveTicketForAssociate(req.user.id, category, client);
      if (activeTicketBlock) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          error: activeTicketBlock.error,
          code: activeTicketBlock.code,
          activeTicket: activeTicketBlock.activeTicket,
        });
      }
    }

    const metadata = await client.query(
      `SELECT c.id AS categoria_id, e.id AS etiqueta_id, c.tiempo_sla_minutos
       FROM configuracion_categorias c
       JOIN etiquetas_categoria e ON e.categoria_id = c.id
       WHERE c.nombre_categoria = $1 AND e.nombre = $2 AND c.is_active = TRUE AND e.is_active = TRUE
       LIMIT 1;`,
      [category, tag]
    );
    if (!metadata.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Categoría o etiqueta inactiva.' });
    }

    const result = await client.query(
      `INSERT INTO tickets (
        titulo, titulo_tecnico, descripcion, usuario_id, solicitante_nombre,
        categoria, etiqueta, prioridad, puntaje_prioridad, respuestas_contexto,
        sla_objetivo_minutos, categoria_id, etiqueta_id, estado, diagnostico_snapshot
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15::jsonb)
      RETURNING *;`,
      [
        category,
        `${associateName} / ${category}`,
        descriptionValidation.value,
        req.user.id,
        associateName,
        category,
        tag,
        scoring.priority,
        scoring.score,
        JSON.stringify(scoring.answers),
        metadata.rows[0].tiempo_sla_minutos,
        metadata.rows[0].categoria_id,
        metadata.rows[0].etiqueta_id,
        TICKET_STATES.OPEN,
        JSON.stringify({
          categoria: { id: metadata.rows[0].categoria_id, nombre: category },
          etiqueta: { id: metadata.rows[0].etiqueta_id, nombre: tag },
          preguntas: config.questions.map((question) => ({
            id: question.id,
            key: question.legacy_key || null,
            pregunta: question.pregunta,
            requerida: question.is_required,
            opciones: question.opciones,
          })),
          respuestas: scoring.answers,
          puntaje_final: scoring.score,
          prioridad_final: scoring.priority,
          sla_final_minutos: metadata.rows[0].tiempo_sla_minutos,
        }),
      ]
    );
    await client.query('COMMIT');
    const assignment = await assignTicket(result.rows[0].id);
    await recordStatusChange({
      ticketId: result.rows[0].id,
      fromStatus: null,
      toStatus: result.rows[0].estado || 'Nuevo',
      actorId: req.user.id,
      actorName: associateName,
      actorRole: req.user.role,
      reason: 'Ticket creado por asociado',
      metadata: { category, tag, priority: scoring.priority, assignment },
    });
    await createNotification({
      username: 'admin',
      ticketId: result.rows[0].id,
      type: 'ticket_created',
      severity: String(scoring.priority).toLowerCase().includes('crit') ? 'critical' : String(scoring.priority).toLowerCase().includes('alt') ? 'warning' : 'info',
      title: 'Nuevo ticket creado',
      body: result.rows[0].titulo_tecnico || result.rows[0].titulo,
      payload: { category, tag, priority: scoring.priority, assigned: assignment.assigned === true },
    });
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'ticket.crear',
      entity: 'tickets',
      entityId: result.rows[0].id,
      detail: { category, tag, priority: scoring.priority, assigned: assignment.assigned === true },
      before: null,
      after: assignment.ticket || result.rows[0],
    });
    res.status(201).json({
      message: 'Ticket creado correctamente.',
      ticket: assignment.ticket || result.rows[0],
      assignment,
      assignment_reason: assignment.assignment_reason || null,
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Error en POST /tickets:', error.message);
    res.status(500).json({ error: 'No se pudo guardar el ticket.' });
  } finally {
    if (client) client.release();
  }
});

async function canAccessTicket(req, ticketId) {
  if (req.user.role === 'admin') return true;
  const result = await pool.query('SELECT usuario_id,tecnico_id FROM tickets WHERE id=$1', [ticketId]);
  const ticket = result.rows[0];
  if (!ticket) return false;
  if (req.user.role === 'associate') return Number(ticket.usuario_id) === Number(req.user.id);
  if (req.user.role === 'tech') return Number(ticket.tecnico_id) === Number(req.user.id);
  return false;
}

router.get('/:id/history', async (req, res) => {
  const ticketId = Number(req.params.id);
  if (!ticketId) return res.status(400).json({ success: false, error: 'ID de ticket inválido.' });
  if (!await canAccessTicket(req, ticketId)) return res.status(403).json({ success: false, error: 'No tiene acceso a este ticket.' });
  try {
    const history = await getTicketHistory(ticketId);
    res.json({ success: true, history });
  } catch (error) {
    res.status(500).json({ success: false, error: 'No se pudo consultar el historial del ticket.' });
  }
});

router.get('/:id', async (req, res) => {
  const ticketId = Number(req.params.id);
  if (!ticketId) return res.status(400).json({ error: 'ID de ticket inválido.' });
  if (!await canAccessTicket(req, ticketId)) return res.status(403).json({ error: 'No tiene acceso a este ticket.' });

  const [ticket, messages, pauses, assignments, legacyRatings, formalRatings] = await Promise.all([
    pool.query(`
      SELECT t.*,
             a.full_name AS solicitante_full_name,
             te.full_name AS tecnico_full_name,
             c.nombre_categoria AS categoria_nombre,
             e.nombre AS etiqueta_nombre,
             CASE
               WHEN t.sla_objetivo_minutos IS NULL THEN NULL
               WHEN t.duracion_neta_segundos IS NULL AND t.t_captura IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (NOW() - t.t_captura)) <= t.sla_objetivo_minutos * 60
               WHEN t.duracion_neta_segundos IS NOT NULL
                 THEN t.duracion_neta_segundos <= t.sla_objetivo_minutos * 60
               ELSE NULL
             END AS dentro_sla
      FROM tickets t
      LEFT JOIN app_users a ON a.id=t.usuario_id
      LEFT JOIN app_users te ON te.id=t.tecnico_id
      LEFT JOIN configuracion_categorias c ON c.id=t.categoria_id
      LEFT JOIN etiquetas_categoria e ON e.id=t.etiqueta_id
      WHERE t.id=$1`, [ticketId]),
    pool.query(`SELECT m.*,u.full_name emisor_nombre,u.role emisor_rol FROM mensajes_internos m JOIN app_users u ON u.id=m.emisor_id WHERE m.ticket_id=$1 ORDER BY m.timestamp`, [ticketId]),
    pool.query(`SELECT * FROM historial_pausas WHERE ticket_id=$1 ORDER BY t_pausa_inicio`, [ticketId]),
    pool.query(`SELECT h.*,u.full_name tecnico_nombre,a.full_name asignado_por_nombre FROM historial_asignaciones h LEFT JOIN app_users u ON u.id=h.tecnico_id LEFT JOIN app_users a ON a.id=h.asignado_por WHERE h.ticket_id=$1 ORDER BY h.created_at`, [ticketId]),
    pool.query(`SELECT h.*,t.full_name tecnico_nombre,a.full_name asociado_nombre FROM historial_calificaciones h JOIN app_users t ON t.id=h.tecnico_id JOIN app_users a ON a.id=h.asociado_id WHERE h.ticket_id=$1 ORDER BY h.created_at DESC`, [ticketId]),
    listTicketRatings(ticketId),
  ]);

  if (!ticket.rows[0]) return res.status(404).json({ error: 'Ticket no encontrado.' });
  const current = ticket.rows[0];
  const state = String(current.estado || '').toLowerCase();
  const ratings = formalRatings;
  const hasAssociateRating = ratings.some((rating) => rating.rating_type === 'associate_to_technician');
  const hasTechnicianRating = ratings.some((rating) => rating.rating_type === 'technician_to_associate');
  const role = req.user.role;
  const isOwnerTech = role === 'tech' && Number(current.tecnico_id) === Number(req.user.id);
  const isOwnerAssociate = role === 'associate' && Number(current.usuario_id) === Number(req.user.id);

  res.json({
    ticket: {
      ...current,
      descripcion_breve: normalizeMeaningfulText(current.descripcion).slice(0, 180),
      titulo_tecnico: current.titulo_tecnico,
      categoria: current.categoria_nombre || current.categoria,
      prioridad: current.prioridad,
      tecnico: current.tecnico_id ? {
        id: current.tecnico_id,
        name: current.tecnico_full_name || current.tecnico_nombre,
      } : null,
      asociado: {
        id: current.usuario_id,
        name: current.solicitante_full_name || current.solicitante_nombre,
      },
    },
    messages: messages.rows,
    pauses: pauses.rows,
    assignments: assignments.rows,
    ratings,
    legacyRatings: legacyRatings.rows,
    pendingAssociateRating: state.includes('resuelto') && !hasAssociateRating,
    pendingTechnicianRating: Boolean(current.tecnico_id) && !hasTechnicianRating,
    allowedActions: {
      start: isOwnerTech && !state.includes('progreso') && !state.includes('resuelto') && !state.includes('cerrado'),
      wait: isOwnerTech && state.includes('progreso'),
      plan: isOwnerTech && state.includes('progreso'),
      resolve: isOwnerTech && !state.includes('resuelto') && !state.includes('cerrado'),
      feedback: isOwnerAssociate && state.includes('resuelto'),
      persist: isOwnerAssociate && state.includes('resuelto'),
      adminClose: role === 'admin' && state.includes('resuelto'),
    },
  });
});

router.get('/:id/messages', async (req, res) => {
  const ticketId = Number(req.params.id);
  if (!await canAccessTicket(req, ticketId)) return res.status(403).json({ error: 'No tiene acceso a este ticket.' });
  const result = await pool.query(`SELECT m.*,u.full_name emisor_nombre FROM mensajes_internos m JOIN app_users u ON u.id=m.emisor_id WHERE m.ticket_id=$1 ORDER BY m.timestamp`, [ticketId]);
  res.json(result.rows);
});

router.post('/:id/messages', async (req, res) => {
  const ticketId = Number(req.params.id);
  if (!await canAccessTicket(req, ticketId)) return res.status(403).json({ error: 'No tiene acceso a este ticket.' });
  if (req.user.role === 'associate') {
    let blocked = false;
    await associateBrake(req, { status: () => ({ json: () => { blocked = true; } }) }, () => {});
    if (blocked) return res.status(403).json({ error: 'Completa primero la evaluación pendiente.' });
  }
  const type = String(req.body.tipo_mensaje || 'General');
  const allowed = ['Nota Técnica','Actualización','Escalamiento','General'];
  if (!allowed.includes(type) || !String(req.body.mensaje || '').trim()) return res.status(400).json({ error: 'Mensaje y clasificación válidos son obligatorios.' });
  const result = await pool.query(`INSERT INTO mensajes_internos(ticket_id,emisor_id,mensaje,tipo_mensaje) VALUES($1,$2,$3,$4) RETURNING *`, [ticketId, req.user.id, String(req.body.mensaje).trim(), type]);
  await logAudit({ actorId: req.user.id, action: 'ticket.mensaje', entity: 'tickets', entityId: ticketId, detail: { type } });
  emitToRole('tech', 'message:new', result.rows[0]); emitToUser(req.user.id, 'message:new', result.rows[0]);
  res.status(201).json(result.rows[0]);
});

async function confirmTicket(req, res) {
  if (req.user.role !== 'associate') return res.status(403).json({ error: 'Solo el asociado puede confirmar y calificar su ticket.' });
  let score;
  let comment;
  try {
    score = validateStars(req.body.score ?? req.body.puntuacion ?? req.body.stars);
    comment = validateComment(req.body.comment ?? req.body.comentario_evidencia, 1);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const ticket = await pool.query(`SELECT * FROM tickets WHERE id=$1 AND usuario_id=$2`, [Number(req.params.id), req.user.id]);
  if (canonicalState(ticket.rows[0]?.estado, { strict: false }) === TICKET_STATES.CLOSED) {
    const existing = await pool.query(
      `SELECT id FROM ticket_ratings WHERE ticket_id=$1 AND rating_type='associate_to_technician'`,
      [Number(req.params.id)]
    );
    if (existing.rows[0]) return res.json(ticket.rows[0]);
  }
  if (canonicalState(ticket.rows[0]?.estado, { strict: false }) !== TICKET_STATES.RESOLVED) {
    return res.status(409).json({ error: 'El ticket no está pendiente de confirmación.' });
  }
  if (!ticket.rows[0]?.tecnico_id) return res.status(409).json({ error: 'El ticket no puede calificarse.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await createTicketRating({
      ticketId: ticket.rows[0].id,
      ratingType: 'associate_to_technician',
      raterUserId: req.user.id,
      raterName: req.user.name,
      ratedUserId: ticket.rows[0].tecnico_id,
      ratedName: ticket.rows[0].tecnico_nombre,
      stars: score,
      comment,
      minCommentLength: 1,
      client,
    });
    await client.query(
      `INSERT INTO historial_calificaciones(ticket_id,tecnico_id,asociado_id,puntuacion,comentario_evidencia)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(ticket_id,asociado_id) DO NOTHING`,
      [ticket.rows[0].id, ticket.rows[0].tecnico_id, req.user.id, score, comment]
    );
    await recordStatusChange({
      ticketId: ticket.rows[0].id,
      fromStatus: 'Resuelto',
      toStatus: 'Resuelto',
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      reason: 'Asociado calificó al técnico',
      metadata: { score },
      client,
    });
    assertTransition(ticket.rows[0].estado, TICKET_STATES.CLOSED, { role: req.user.role });
    const closed = await client.query(
      `UPDATE tickets SET estado=$2,cerrado_en=COALESCE(cerrado_en,NOW()),
              fecha_cerrado=COALESCE(fecha_cerrado,NOW()),updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [ticket.rows[0].id, TICKET_STATES.CLOSED]
    );
    await recordStatusChange({
      ticketId: ticket.rows[0].id,
      fromStatus: 'Resuelto',
      toStatus: 'Cerrado',
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      reason: 'Asociado confirmó solución',
      metadata: { score },
      client,
    });
    if (score <= 2) {
      await createNotification({
        username: 'admin',
        ticketId: ticket.rows[0].id,
        type: 'ticket_low_rating',
        severity: 'warning',
        title: 'Baja calificación recibida',
        body: `Ticket #${ticket.rows[0].id} recibió ${score} estrellas.`,
        payload: { ticketId: ticket.rows[0].id, rating_type: 'associate_to_technician', score },
        client,
      });
    }
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'ticket.feedback',
      entity: 'tickets',
      entityId: ticket.rows[0].id,
      detail: { score },
      before: ticket.rows[0],
      after: closed.rows[0],
      client,
    });
    await client.query('COMMIT'); emitToUser(ticket.rows[0].tecnico_id, 'ticket:feedback', { ticketId: ticket.rows[0].id, score });
    reprocessUnassignedTickets().catch((error) => console.error('Error reprocesando bolsa tras cierre:', error.message));
    res.json(closed.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    const duplicate = error.code === '23505';
    res.status(duplicate ? 409 : 500).json({ error: duplicate ? 'Este ticket ya fue calificado por el asociado.' : 'No se pudo guardar la calificación.' });
  }
  finally { client.release(); }
}

router.post('/:id/feedback', idempotency, confirmTicket);
router.post('/:id/confirm', idempotency, confirmTicket);

router.post('/:id/persist', idempotency, async (req, res) => {
  if (req.user.role !== 'associate') return res.status(403).json({ error: 'Solo el asociado puede indicar que la falla persiste.' });
  let comment;
  try {
    comment = validateComment(req.body.comment ?? req.body.comentario, 25);
  } catch (error) {
    return res.status(400).json({ error: `Para reabrir el ticket, ${error.message}` });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT * FROM tickets WHERE id=$1 AND usuario_id=$2 FOR UPDATE`, [Number(req.params.id), req.user.id]);
    if (!current.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'El ticket no existe o no pertenece al asociado.' }); }
    if (canonicalState(current.rows[0].estado, { strict: false }) === TICKET_STATES.IN_PROGRESS) {
      await client.query('COMMIT');
      return res.json(current.rows[0]);
    }
    if (canonicalState(current.rows[0].estado, { strict: false }) !== TICKET_STATES.RESOLVED) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Este ticket ya no está pendiente de validación.' }); }
    assertTransition(current.rows[0].estado, TICKET_STATES.IN_PROGRESS, { role: req.user.role });
    const ticket = await client.query(`UPDATE tickets SET estado=$2,t_resolucion=NULL,updated_at=NOW() WHERE id=$1 RETURNING *`, [Number(req.params.id), TICKET_STATES.IN_PROGRESS]);
    await client.query(`INSERT INTO mensajes_internos(ticket_id,emisor_id,mensaje,tipo_mensaje) VALUES($1,$2,$3,'Escalamiento')`, [ticket.rows[0].id, req.user.id, comment]);
    await recordStatusChange({
      ticketId: ticket.rows[0].id,
      fromStatus: current.rows[0].estado,
      toStatus: 'En Progreso',
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      reason: comment || 'La falla persiste',
      metadata: { persisted: true },
      client,
    });
    await createNotification({
      userId: ticket.rows[0].tecnico_id,
      ticketId: ticket.rows[0].id,
      type: 'ticket_reopened',
      severity: 'warning',
      title: 'Ticket reabierto por falla persistente',
      body: comment,
      payload: { ticketId: ticket.rows[0].id },
      client,
    });
    await logAudit({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'ticket.reabrir',
      entity: 'tickets',
      entityId: ticket.rows[0].id,
      detail: { reason: comment },
      before: current.rows[0],
      after: ticket.rows[0],
      client,
    });
    await client.query('COMMIT');
    emitToUser(ticket.rows[0].tecnico_id, 'ticket:reopened', ticket.rows[0]);
    res.json(ticket.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'No se pudo reabrir el ticket.' });
  } finally { client.release(); }
});

module.exports = router;
