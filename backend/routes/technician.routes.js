const express = require('express');
const pool = require('../db');
const { requireAuth } = require('./auth.routes');
const { setTechnicianPresence } = require('../services/presence.service');
const { emitAll, emitToUser, emitToRole } = require('../services/realtime.service');
const { netResolutionSeconds } = require('../domain/netResolutionTime');
const { logAudit } = require('../services/audit.service');
const { recordStatusChange } = require('../services/statusHistory.service');
const { createNotification } = require('../services/notification.service');
const { createTicketRating, validateComment, validateStars } = require('../services/rating.service');
const { idempotency } = require('../middleware/idempotency');
const {
  TICKET_STATES,
  normalizeTicketState: canonicalState,
  assertTransition,
} = require('../domain/ticketState');
const { reprocessUnassignedTickets } = require('../services/assignment.service');

const router = express.Router();

router.use(requireAuth);
router.use((req, res, next) => {
  if (req.user.role !== 'tech') {
    return res.status(403).json({ error: 'Esta operación requiere un perfil técnico.' });
  }
  return next();
});

let workflowSchemaReady = false;

async function ensureTicketWorkflowSchema() {
  if (workflowSchemaReady) return;

  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS estado VARCHAR(50) NOT NULL DEFAULT 'Abierto';`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS prioridad VARCHAR(30) NOT NULL DEFAULT 'Media';`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS categoria VARCHAR(80) NOT NULL DEFAULT 'Software';`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tecnico_id INTEGER;`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tecnico_nombre VARCHAR(140);`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_inicio TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_espera TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_planificada TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_resuelto TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS t_apertura TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS t_captura TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS t_resolucion TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets(estado);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tickets_prioridad ON tickets(prioridad);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tickets_tecnico_id ON tickets(tecnico_id);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_status_history (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL,
      from_status VARCHAR(50),
      to_status VARCHAR(50) NOT NULL,
      actor_id INTEGER NULL,
      actor_name VARCHAR(150) NULL,
      actor_role VARCHAR(50) NULL,
      reason TEXT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ticket_status_history_ticket_id ON ticket_status_history(ticket_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ticket_status_history_created_at ON ticket_status_history(created_at DESC);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS historial_pausas (
      id BIGSERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL,
      tipo_pausa VARCHAR(30) NOT NULL,
      t_pausa_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      t_pausa_fin TIMESTAMPTZ,
      created_by INTEGER,
      CHECK (t_pausa_fin IS NULL OR t_pausa_fin >= t_pausa_inicio)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pausas_ticket ON historial_pausas(ticket_id, t_pausa_inicio);`);

  workflowSchemaReady = true;
}

function normalizeActionUser(req) {
  return {
    technicianId: Number(req.user.id) || null,
    technicianName: String(req.user.name || 'Técnico TI').trim(),
  };
}

function getResolvePayload(body) {
  const evidence = validateComment(body.evidencia_resolucion ?? body.evidence ?? body.resolutionEvidence, 25);
  const rating = body.associateRating || {};
  const stars = validateStars(body.associateStars ?? body.associate_stars ?? rating.stars ?? body.stars);
  const comment = validateComment(body.associateComment ?? body.associate_comment ?? rating.comment ?? body.comment, 1);
  return { evidence, stars, comment };
}

function getPlanPayload(body) {
  const rawDate = body.fecha_planificada ?? body.plannedAt ?? body.planned_at ?? body.scheduledAt;
  if (!String(rawDate || '').trim()) {
    const error = new Error('Debe seleccionar una fecha para planificar el ticket.');
    error.code = 'PLANNED_DATE_REQUIRED';
    throw error;
  }
  const plannedDate = new Date(rawDate);
  if (Number.isNaN(plannedDate.getTime())) {
    const error = new Error('La fecha de planificación no es válida.');
    error.code = 'PLANNED_DATE_INVALID';
    throw error;
  }
  return { fecha_planificada: plannedDate.toISOString() };
}

function normalizeTicketState(state) {
  return String(canonicalState(state, { strict: false }) || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, '_');
}

function isStartAllowedFromState(state) {
  return new Set(['abierto', 'nuevo', 'en_espera', 'planificado']).has(normalizeTicketState(state));
}

function isClosedOrResolvedState(state) {
  return new Set(['cerrado', 'resuelto']).has(normalizeTicketState(state));
}

function actionFailureMessage(action) {
  if (action === 'start') return 'No se pudo iniciar la atención del ticket.';
  return 'No se pudo actualizar el ticket.';
}

async function updateTicket(req, res, config) {
  await ensureTicketWorkflowSchema();
  const ticketId = Number(req.params.id);

  if (!ticketId) {
    return res.status(400).json({ error: 'ID de ticket inválido.' });
  }

  const { technicianId, technicianName } = normalizeActionUser(req);
  let resolvePayload = null;
  let planPayload = null;
  if (config.action === 'plan') {
    try {
      planPayload = getPlanPayload(req.body || {});
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message,
        code: error.code || 'PLANNED_DATE_INVALID',
      });
    }
  }

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT t.*,
              t.fecha_planificada,
              COALESCE(t.t_apertura, t.created_at) AS fecha_creacion_ticket,
              a.full_name AS asociado_nombre
       FROM tickets t
       LEFT JOIN app_users a ON a.id=t.usuario_id
       WHERE t.id = $1
       FOR UPDATE OF t;`,
      [ticketId]
    );
    const ticket = current.rows[0];
    if (!ticket) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ticket no encontrado.' }); }
    if (Number(ticket.tecnico_id) !== technicianId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'El ticket no está asignado a este técnico.' });
    }
    if (config.action === 'resolve') {
      const normalizedState = normalizeTicketState(ticket.estado);
      if (normalizedState === 'cerrado') {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'El ticket ya está cerrado.' });
      }

      const existingRating = await client.query(
        `SELECT * FROM ticket_ratings
         WHERE ticket_id=$1 AND rating_type='technician_to_associate'
         LIMIT 1`,
        [ticketId]
      );
      if (existingRating.rows[0]) {
        if (normalizedState === 'resuelto') {
          await client.query('COMMIT');
          committed = true;
          return res.json({ success: true, message: config.message, ticket });
        }
        try {
          assertTransition(ticket.estado, TICKET_STATES.RESOLVED, { role: req.user.role });
        } catch (error) {
          await client.query('ROLLBACK');
          return res.status(409).json({ success: false, code: error.code, error: error.message });
        }

        const synchronized = await client.query(
          `UPDATE tickets
           SET estado='Resuelto',
               fecha_resuelto=COALESCE(fecha_resuelto, NOW()),
               t_resolucion=COALESCE(t_resolucion, NOW()),
               updated_at=NOW()
           WHERE id=$1
           RETURNING *`,
          [ticketId]
        );
        await client.query(
          `UPDATE historial_pausas SET t_pausa_fin=NOW()
           WHERE ticket_id=$1 AND t_pausa_fin IS NULL`,
          [ticketId]
        );
        await recordStatusChange({
          ticketId,
          fromStatus: ticket.estado,
          toStatus: 'Resuelto',
          actorId: technicianId,
          actorName: technicianName,
          actorRole: req.user.role,
          reason: 'Resolución sincronizada',
          metadata: { action: 'resolve', reused_rating_id: existingRating.rows[0].id },
          client,
        });
        await logAudit({
          actorId: technicianId,
          actorUsername: req.user.username,
          actorRole: req.user.role,
          action: 'ticket.resolve.sync',
          entity: 'tickets',
          entityId: ticketId,
          detail: { reused_rating_id: existingRating.rows[0].id },
          before: ticket,
          after: synchronized.rows[0],
          client,
        });
        await client.query('COMMIT');
        committed = true;
        emitToUser(ticket.usuario_id, 'ticket:resolved', synchronized.rows[0]);
        return res.json({ success: true, message: config.message, ticket: synchronized.rows[0] });
      }

      try {
        resolvePayload = getResolvePayload(req.body || {});
      } catch (error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: error.message });
      }
    }
    try {
      assertTransition(ticket.estado, config.estado, { role: req.user.role });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, code: error.code, error: error.message });
    }
    if (config.action !== 'resolve' && canonicalState(ticket.estado) === canonicalState(config.estado)) {
      await client.query('COMMIT');
      committed = true;
      return res.json({ success: true, message: config.message, ticket });
    }
    if (config.action === 'start' && isClosedOrResolvedState(ticket.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'No se puede iniciar atención de un ticket cerrado o resuelto.',
        code: 'INVALID_TICKET_STATE',
      });
    }
    if (config.action === 'start' && !isStartAllowedFromState(ticket.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'El ticket no se puede iniciar desde su estado actual.',
        code: 'INVALID_START_STATE',
      });
    }
    if (config.action === 'plan') {
      const creationDate = new Date(ticket.fecha_creacion_ticket);
      const plannedDate = new Date(planPayload.fecha_planificada);
      if (!Number.isNaN(creationDate.getTime()) && plannedDate < creationDate) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'La fecha planificada no puede ser anterior a la creación del ticket.',
          code: 'PLANNED_DATE_BEFORE_CREATION',
        });
      }
    }
    if (config.lockWhenStarting) {
      const isAlreadyInProgress = String(ticket.estado || '').toLowerCase().includes('progreso');
      const belongsToAnotherTech = ticket.tecnico_id && technicianId && Number(ticket.tecnico_id) !== Number(technicianId);

      if (belongsToAnotherTech || (isAlreadyInProgress && !ticket.tecnico_id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Este ticket ya está siendo atendido por otro técnico.' });
      }
    }

    if (config.action === 'start' || config.action === 'resolve') {
      await client.query(
        `UPDATE historial_pausas SET t_pausa_fin = NOW()
         WHERE ticket_id = $1 AND t_pausa_fin IS NULL;`,
        [ticketId]
      );
    }

    if (config.action === 'wait' || config.action === 'plan') {
      await client.query(
        `INSERT INTO historial_pausas (ticket_id, tipo_pausa, created_by)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (SELECT 1 FROM historial_pausas WHERE ticket_id = $1 AND t_pausa_fin IS NULL);`,
        [ticketId, config.action === 'wait' ? 'En Espera' : 'Planificada', technicianId]
      );
    }

    const result = await client.query(
      `
      UPDATE tickets
      SET
        estado = $1,
        tecnico_id = COALESCE($2, tecnico_id),
        tecnico_nombre = COALESCE($3, tecnico_nombre),
        fecha_inicio = CASE WHEN $4 = 'start' THEN COALESCE(fecha_inicio, NOW()) ELSE fecha_inicio END,
        fecha_espera = CASE WHEN $4 = 'wait' THEN NOW() ELSE fecha_espera END,
        fecha_planificada = CASE WHEN $4 = 'plan' THEN $6::timestamptz ELSE fecha_planificada END,
        fecha_resuelto = CASE WHEN $4 = 'resolve' THEN COALESCE(fecha_resuelto, NOW()) ELSE fecha_resuelto END,
        t_captura = CASE WHEN $4 = 'start' THEN COALESCE(t_captura, NOW()) ELSE t_captura END,
        t_resolucion = CASE WHEN $4 = 'resolve' THEN COALESCE(t_resolucion, NOW()) ELSE t_resolucion END,
        updated_at = NOW()
      WHERE id = $5
      RETURNING *;
      `,
      [config.estado, technicianId, technicianName, config.action, ticketId, planPayload?.fecha_planificada || null]
    );

    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ticket no encontrado.' });
    }

    const defaultReasons = {
      start: 'Técnico inició atención',
      wait: 'En espera de usuario/insumo',
      plan: 'Ticket planificado por técnico',
      resolve: 'Técnico marcó como resuelto',
    };
    const historyReason = config.action === 'plan' || config.action === 'start'
      ? defaultReasons[config.action]
      : resolvePayload?.evidence || String(req.body.reason || req.body.evidence || '').trim() || defaultReasons[config.action];
    const historyMetadata = {
      action: config.action,
      body: req.body || {},
      ...(planPayload ? { fecha_planificada: planPayload.fecha_planificada } : {}),
      ...(config.action === 'start' ? {
        from_planned: normalizeTicketState(ticket.estado) === 'planificado',
        fecha_planificada: ticket.fecha_planificada || null,
      } : {}),
    };
    await recordStatusChange({
      ticketId,
      fromStatus: ticket.estado,
      toStatus: config.estado,
      actorId: technicianId,
      actorName: technicianName,
      actorRole: req.user.role,
      reason: historyReason,
      metadata: historyMetadata,
      client,
    });
    if (config.action === 'resolve') {
      await createTicketRating({
        ticketId,
        ratingType: 'technician_to_associate',
        raterUserId: technicianId,
        raterName: technicianName,
        ratedUserId: ticket.usuario_id,
        ratedName: ticket.asociado_nombre || ticket.solicitante_nombre,
        stars: resolvePayload.stars,
        comment: resolvePayload.comment,
        minCommentLength: 1,
        client,
      });
      await recordStatusChange({
        ticketId,
        fromStatus: config.estado,
        toStatus: config.estado,
        actorId: technicianId,
        actorName: technicianName,
        actorRole: req.user.role,
        reason: 'Técnico calificó al asociado',
        metadata: { score: resolvePayload.stars },
        client,
      });
      if (resolvePayload.stars <= 2) {
        await createNotification({
          username: 'admin',
          ticketId,
          type: 'ticket_low_rating',
          severity: 'warning',
          title: 'Baja calificación recibida',
          body: `Ticket #${ticketId} recibió ${resolvePayload.stars} estrellas del técnico.`,
          payload: { ticketId, rating_type: 'technician_to_associate', score: resolvePayload.stars },
          client,
        });
      }
      await createNotification({
        userId: result.rows[0].usuario_id,
        ticketId,
        type: 'ticket_resolved',
        severity: 'success',
        title: 'Tu ticket fue resuelto',
        body: result.rows[0].titulo || result.rows[0].titulo_tecnico,
        payload: { ticketId, tecnico_id: technicianId },
        client,
      });
    }

    await client.query('COMMIT');
    committed = true;
    try {
      if (config.action === 'resolve') {
        const pauses = await pool.query('SELECT t_pausa_inicio,t_pausa_fin FROM historial_pausas WHERE ticket_id=$1', [ticketId]);
        const seconds = netResolutionSeconds(result.rows[0].t_captura, result.rows[0].t_resolucion, pauses.rows);
        await pool.query('UPDATE tickets SET duracion_neta_segundos=$1,evidencia_resolucion=$2 WHERE id=$3', [seconds, resolvePayload.evidence, ticketId]);
        emitToUser(result.rows[0].usuario_id, 'ticket:resolved', result.rows[0]);
      }
      await logAudit({
        actorId: technicianId,
        actorUsername: req.user.username,
        actorRole: req.user.role,
        action: `ticket.${config.action}`,
        entity: 'tickets',
        entityId: ticketId,
        detail: { estado: config.estado },
        before: ticket,
        after: result.rows[0],
      });
      if (config.action === 'start') emitAll('ticket:locked', { ticketId, technicianId });
      await setTechnicianPresence(technicianId, config.action === 'start' ? 'Ocupado' : 'Activo');
      if (config.action === 'resolve') {
        await reprocessUnassignedTickets();
      }
    } catch (sideEffectError) {
      console.error(`Error en efectos secundarios de acción técnica ${config.action}:`, sideEffectError);
    }
    return res.json({ success: true, message: config.message, ticket: result.rows[0] });
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    if (config.action === 'start') console.error('Error iniciando atención:', error);
    else console.error(`❌ Error en acción técnica ${config.action}:`, error);
    if (error.code === '23505' && config.action === 'resolve') {
      return res.status(409).json({ success: false, error: 'La resolución fue actualizada por otra solicitud; vuelva a consultar el ticket.' });
    }
    const payload = {
      success: false,
      error: actionFailureMessage(config.action),
    };
    if (process.env.NODE_ENV === 'development') payload.detail = error.message;
    return res.status(500).json(payload);
  } finally {
    client.release();
  }
}

async function startTicket(req, res) {
  await ensureTicketWorkflowSchema();
  const ticketId = Number(req.params.id);
  const { technicianId, technicianName } = normalizeActionUser(req);
  let client = null;
  let transactionStarted = false;
  let committed = false;

  if (!ticketId) {
    return res.status(400).json({ success: false, error: 'ID de ticket inválido.' });
  }

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    const current = await client.query(
      `SELECT id, estado, prioridad, tecnico_id, tecnico_nombre, fecha_planificada
       FROM tickets
       WHERE id = $1
       FOR UPDATE`,
      [ticketId]
    );
    const ticket = current.rows[0];

    if (!ticket) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ success: false, error: 'Ticket no encontrado.' });
    }

    if (Number(ticket.tecnico_id) !== technicianId) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ success: false, error: 'El ticket no está asignado a este técnico.' });
    }

    await client.query(
      'SELECT pg_advisory_xact_lock($1,$2)',
      [20260702, technicianId]
    );

    if (canonicalState(ticket.estado) === TICKET_STATES.IN_PROGRESS) {
      await client.query('COMMIT');
      transactionStarted = false;
      committed = true;
      return res.json({ success: true, message: 'Ticket iniciado correctamente.', ticket });
    }

    const ticketPriority = String(ticket.prioridad || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (ticketPriority === 'alta' || ticketPriority === 'critica') {
      const busy = await client.query(
        `SELECT id FROM tickets
         WHERE tecnico_id=$1 AND id<>$2
           AND estado='En Progreso'
           AND prioridad IN ('Alta','Crítica')
         ORDER BY COALESCE(fecha_inicio,t_captura,created_at),id
         LIMIT 1`,
        [technicianId, ticketId]
      );
      if (busy.rows[0]) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          code: 'TECHNICIAN_BUSY_HIGH_PRIORITY',
          error: 'El técnico ya atiende un ticket de alta prioridad o crítica.',
          conflictingTicketId: busy.rows[0].id,
        });
      }
    }

    if (isClosedOrResolvedState(ticket.estado)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        error: 'No se puede iniciar atención de un ticket cerrado o resuelto.',
        code: 'INVALID_TICKET_STATE',
      });
    }

    if (!isStartAllowedFromState(ticket.estado)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        error: 'El ticket no se puede iniciar desde su estado actual.',
        code: 'INVALID_START_STATE',
      });
    }
    try {
      assertTransition(ticket.estado, TICKET_STATES.IN_PROGRESS, { role: req.user.role });
    } catch (error) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ success: false, code: error.code, error: error.message });
    }

    await client.query(
      `UPDATE historial_pausas
       SET t_pausa_fin = NOW()
       WHERE ticket_id = $1 AND t_pausa_fin IS NULL`,
      [ticketId]
    );

    const updated = await client.query(
      `UPDATE tickets
       SET estado = 'En Progreso',
           tecnico_id = COALESCE($1, tecnico_id),
           tecnico_nombre = COALESCE($2, tecnico_nombre),
           fecha_inicio = COALESCE(fecha_inicio, NOW()),
           t_captura = COALESCE(t_captura, NOW()),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [technicianId, technicianName, ticketId]
    );

    await recordStatusChange({
      ticketId,
      fromStatus: ticket.estado,
      toStatus: 'En Progreso',
      actorId: technicianId,
      actorName: technicianName,
      actorRole: req.user.role,
      reason: 'Técnico inició atención',
      metadata: {
        action: 'start',
        from_planned: normalizeTicketState(ticket.estado) === 'planificado',
        fecha_planificada: ticket.fecha_planificada || null,
      },
      client,
    });

    await client.query('COMMIT');
    transactionStarted = false;
    committed = true;

    try {
      await logAudit({
        actorId: technicianId,
        actorUsername: req.user.username,
        actorRole: req.user.role,
        action: 'ticket.start',
        entity: 'tickets',
        entityId: ticketId,
        detail: { estado: 'En Progreso', from_status: ticket.estado },
        before: ticket,
        after: updated.rows[0],
      });
      emitAll('ticket:locked', { ticketId, technicianId });
      await setTechnicianPresence(technicianId, 'Ocupado');
    } catch (sideEffectError) {
      console.error('START_TICKET_SIDE_EFFECT_ERROR', {
        ticketId,
        technicianId,
        message: sideEffectError.message,
        stack: sideEffectError.stack,
      });
    }

    return res.json({
      success: true,
      message: 'Ticket iniciado correctamente.',
      ticket: updated.rows[0],
    });
  } catch (error) {
    if (transactionStarted && !committed && client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('START_TICKET_ERROR', {
      ticketId,
      technicianId,
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      error: 'No se pudo iniciar la atención del ticket.',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  } finally {
    if (client) client.release();
  }
}

router.use(async (req, res, next) => {
  try {
    await ensureTicketWorkflowSchema();
    next();
  } catch (error) {
    console.error('❌ Error preparando workflow técnico:', error.message);
    res.status(500).json({ error: 'No se pudo preparar el workflow de tickets.' });
  }
});

router.post('/tickets/:id/reject', async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'El motivo de rechazo es obligatorio.' });
  const previous = await pool.query(`SELECT id,estado FROM tickets WHERE id=$1 AND tecnico_id=$2 LIMIT 1`, [Number(req.params.id), req.user.id]);
  if (previous.rows[0]) {
    try {
      assertTransition(previous.rows[0].estado, TICKET_STATES.WAITING, { role: req.user.role });
    } catch (error) {
      return res.status(409).json({ success: false, code: error.code, error: error.message });
    }
  }
  const result = await pool.query(`UPDATE tickets SET estado=$4,motivo_rechazo_tecnico=$1,rechazado_en=NOW(),tecnico_id=NULL,tecnico_nombre=NULL,asignacion_estado='Bolsa de Espera',updated_at=NOW() WHERE id=$2 AND tecnico_id=$3 RETURNING *`, [reason, Number(req.params.id), req.user.id, TICKET_STATES.WAITING]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Ticket asignado no encontrado.' });
  const { client } = require('../redis'); await client.zAdd('helpdesk:tickets:bolsa_espera', [{ score: Date.now(), value: String(req.params.id) }]);
  await recordStatusChange({
    ticketId: Number(req.params.id),
    fromStatus: previous.rows[0]?.estado || result.rows[0].estado,
    toStatus: TICKET_STATES.WAITING,
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    reason,
    metadata: { action: 'reject', asignacion_estado: 'Bolsa de Espera' },
  });
  await createNotification({
    username: 'admin',
    ticketId: Number(req.params.id),
    type: 'ticket_rejected',
    severity: 'warning',
    title: 'Ticket rechazado por técnico',
    body: reason,
    payload: { ticketId: Number(req.params.id), technicianId: req.user.id, reason },
  }).catch(() => {});
  await logAudit({ actorId: req.user.id, action: 'ticket.rechazar', entity: 'tickets', entityId: Number(req.params.id), detail: { reason } });
  await setTechnicianPresence(req.user.id, 'Activo');
  emitToRole('admin', 'ticket:rejected', result.rows[0]); res.json(result.rows[0]);
});

router.get('/dashboard/:technicianId', async (req, res) => {
  const technicianId = Number(req.params.technicianId);
  if (technicianId !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Solo puedes consultar tu propio dashboard técnico.' });
  }

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM tickets
      WHERE tecnico_id = $1
      ORDER BY
        CASE
          WHEN LOWER(prioridad) LIKE '%crit%' THEN 1
          WHEN LOWER(prioridad) LIKE '%alt%' THEN 2
          WHEN LOWER(prioridad) LIKE '%med%' THEN 3
          WHEN LOWER(prioridad) LIKE '%baj%' THEN 4
          ELSE 5
        END,
        id DESC;
      `,
      [technicianId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error en GET /technician/dashboard:', error.message);
    res.status(500).json({ error: 'No se pudo cargar el dashboard técnico.' });
  }
});

router.post('/tickets/:id/start', idempotency, startTicket);

router.post('/tickets/:id/wait', idempotency, (req, res) => updateTicket(req, res, {
  action: 'wait',
  estado: 'En Espera',
  message: 'Ticket puesto en espera.',
}));

router.post('/tickets/:id/plan', idempotency, (req, res) => updateTicket(req, res, {
  action: 'plan',
  estado: 'Planificado',
  message: 'Ticket planificado.',
}));

router.post('/tickets/:id/resolve', idempotency, (req, res) => updateTicket(req, res, {
  action: 'resolve',
  estado: 'Resuelto',
  message: 'Ticket resuelto.',
}));

module.exports = router;
