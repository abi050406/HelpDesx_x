const pool = require('../db');
const { client } = require('../redis');
const { emitToUser, emitToRole } = require('./realtime.service');
const { createNotification } = require('./notification.service');
const { selectSmartTechnician, priorityValue } = require('../domain/smartAssignmentEngine');
const { redundantHighPriorityTickets } = require('../domain/highPriorityRepair');

const WAITING_KEY = 'helpdesk:tickets:bolsa_espera';

async function activeTechnicians() {
  const rows = await client.hGetAll('helpdesk:tecnicos:presencia').catch((error) => {
    console.error('No se pudo consultar presencia para asignación:', error.message);
    return {};
  });
  return Object.entries(rows).map(([id, raw]) => ({ id: Number(id), ...JSON.parse(raw) }))
    .filter((item) => item.estado === 'Activo');
}

async function assignmentDecision(ticketId) {
  const ticketResult = await pool.query('SELECT * FROM tickets WHERE id=$1 LIMIT 1', [ticketId]);
  const ticket = ticketResult.rows[0];
  if (!ticket) throw new Error('Ticket no encontrado.');
  const [presence, configured] = await Promise.all([
    client.hGetAll('helpdesk:tecnicos:presencia').catch((error) => {
      console.error('No se pudo consultar presencia para decisión de asignación:', error.message);
      return {};
    }),
    pool.query(
      `SELECT u.id,u.full_name,u.is_active,u.exclusion_corporativa,
              u.max_active_tickets,cfg.excluido,
              cfg.prioridad_skill AS prioridad_asignacion,
              COALESCE(metrics.active_load,0)::int AS active_load,
              COALESCE(metrics.high_critical_in_progress,0)::int AS high_critical_in_progress,
              COALESCE(metrics.high_critical_active,0)::int AS high_critical_active,
              COALESCE(metrics.overdue_sla,0)::int AS overdue_sla,
              COALESCE(metrics.planned_conflict,FALSE) AS planned_conflict,
              EXISTS (
                SELECT 1 FROM conflictos_atencion conflict
                WHERE conflict.asociado_id=$2 AND conflict.tecnico_id=u.id AND conflict.activo=TRUE
              ) AS has_associate_conflict,
              last_assignment.ultima_asignacion
       FROM tecnico_categoria_config cfg
       JOIN app_users u ON u.id=cfg.tecnico_id AND u.role='tecnico'
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (
             WHERE active.estado IN ('Abierto','En Progreso','En Espera','Planificado')
           ) AS active_load,
           COUNT(*) FILTER (
             WHERE active.estado='En Progreso' AND active.prioridad IN ('Alta','Crítica')
           ) AS high_critical_in_progress,
           COUNT(*) FILTER (
             WHERE active.estado IN ('Abierto','En Progreso','En Espera','Planificado')
               AND active.prioridad IN ('Alta','Crítica')
           ) AS high_critical_active,
           COUNT(*) FILTER (
             WHERE active.estado IN ('Abierto','En Progreso','En Espera','Planificado')
               AND active.sla_objetivo_minutos IS NOT NULL
               AND COALESCE(active.t_captura,active.t_apertura,active.created_at)
                   + active.sla_objetivo_minutos * INTERVAL '1 minute' < NOW()
           ) AS overdue_sla,
           BOOL_OR(
             active.estado='Planificado'
             AND $3::timestamptz IS NOT NULL
             AND active.fecha_planificada IS NOT NULL
             AND tstzrange(
               active.fecha_planificada,
               active.fecha_planificada + COALESCE(active.sla_objetivo_minutos,60) * INTERVAL '1 minute',
               '[)'
             ) && tstzrange(
               $3::timestamptz,
               $3::timestamptz + COALESCE($4::int,60) * INTERVAL '1 minute',
               '[)'
             )
           ) AS planned_conflict
         FROM tickets active
         WHERE active.tecnico_id=u.id AND active.id<>$1
       ) metrics ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(h.created_at) AS ultima_asignacion
         FROM historial_asignaciones h WHERE h.tecnico_id=u.id
       ) last_assignment ON TRUE
       WHERE cfg.categoria_id=$5
       ORDER BY cfg.prioridad_skill,u.id`,
      [ticket.id, ticket.usuario_id, ticket.fecha_planificada, ticket.sla_objetivo_minutos, ticket.categoria_id]
    ),
  ]);
  const candidates = configured.rows.map((row) => {
    const rawPresence = presence[String(row.id)];
    const parsedPresence = rawPresence ? JSON.parse(rawPresence) : null;
    return {
      ...row,
      presence_estado: parsedPresence?.estado || 'Offline',
      ultima_actividad: parsedPresence?.ultima_actividad || null,
      disponible_desde: parsedPresence?.disponible_desde || null,
    };
  });
  return {
    ticket,
    ticket_priority_value: priorityValue(ticket.prioridad),
    ...selectSmartTechnician(candidates, {
      ruleCount: candidates.filter((candidate) => candidate.excluido !== true).length,
      incomingPriorityValue: priorityValue(ticket.prioridad),
    }),
  };
}

async function assignTicket(ticketId, options = {}) {
  const categoryResult = await pool.query('SELECT categoria_id FROM tickets WHERE id=$1 LIMIT 1', [ticketId]);
  if (!categoryResult.rows[0]) throw new Error('Ticket no encontrado.');
  const assignmentLock = await pool.connect();
  let lockStarted = false;
  try {
  await assignmentLock.query('BEGIN');
  lockStarted = true;
  await assignmentLock.query(
    'SELECT pg_advisory_xact_lock($1,$2)',
    [20260630, Number(categoryResult.rows[0].categoria_id) || 0]
  );

  const ticketResult = await pool.query('SELECT * FROM tickets WHERE id=$1 LIMIT 1', [ticketId]);
  const ticket = ticketResult.rows[0];
  if (!ticket) throw new Error('Ticket no encontrado.');
  if (ticket.tecnico_id && ticket.asignacion_estado === 'Asignado'
      && (!options.forcedTechnicianId || Number(options.forcedTechnicianId) === Number(ticket.tecnico_id))) {
    return { assigned: true, idempotent: true, assignment_reason: ticket.assignment_reason || null, ticket };
  }

  let decision = await assignmentDecision(ticketId);
  let selected = decision.selected;
  if (options.forcedTechnicianId) {
    selected = decision.candidates.find((row) =>
      Number(row.id) === Number(options.forcedTechnicianId) && row.elegible);
    if (!selected) {
      const error = new Error('El técnico indicado no está activo, disponible, habilitado para la categoría o no tiene capacidad.');
      error.code = 'TECHNICIAN_NOT_ELIGIBLE';
      throw error;
    }
  }
  if (!options.forcedTechnicianId && decision.ticket_priority_value >= 3 && selected) {
    const lockedTechnicians = new Set();
    while (selected && !lockedTechnicians.has(Number(selected.id))) {
      await assignmentLock.query(
        'SELECT pg_advisory_xact_lock($1,$2)',
        [20260702, Number(selected.id)]
      );
      lockedTechnicians.add(Number(selected.id));
      const fresh = await assignmentDecision(ticketId);
      const concurrencyCandidates = fresh.candidates.map((candidate) => ({
        ...candidate,
        high_critical_in_progress: Math.max(
          Number(candidate.high_critical_in_progress || 0),
          Number(candidate.high_critical_active || 0)
        ),
      }));
      const concurrencyDecision = selectSmartTechnician(concurrencyCandidates, {
        ruleCount: concurrencyCandidates.filter((candidate) => candidate.excluido !== true).length,
        incomingPriorityValue: fresh.ticket_priority_value,
      });
      decision = { ...fresh, ...concurrencyDecision };
      selected = decision.selected;
    }
  }

  if (!selected) {
    const reason = decision.assignmentReason;
    const waitingTicket = await pool.query(
      `UPDATE tickets SET asignacion_estado='Bolsa de Espera',assignment_status='waiting_pool',assignment_reason=$2,
              tecnico_id=NULL,tecnico_nombre=NULL,updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [ticketId, reason]
    );
    await client.zAdd(WAITING_KEY, [{ score: Date.now(), value: String(ticketId) }])
      .catch((error) => console.error('No se pudo agregar ticket a Redis; permanece marcado en BD:', error.message));
    await pool.query(
      "INSERT INTO historial_asignaciones(ticket_id,tipo,detalle) VALUES($1,'Bolsa de Espera',$2::jsonb)",
      [ticketId, JSON.stringify({
        assignment_reason: reason,
        skipped_candidates: decision.skippedCandidates,
      })]
    );
    await createNotification({
      username: 'admin',
      ticketId,
      type: 'ticket_created',
      severity: 'warning',
      title: 'Ticket en bolsa de espera',
      body: ticket.titulo_tecnico || ticket.titulo,
      payload: { assignment_reason: reason, prioridad: ticket.prioridad },
    }).catch(() => {});
    emitToRole('admin', 'ticket:waiting', { ticketId });
    return {
      assigned: false,
      waiting: true,
      assignment_reason: reason,
      ticket: waitingTicket.rows[0],
      decision: {
        assignment_reason: reason,
        skipped_candidates: decision.skippedCandidates,
      },
    };
  }

  const effectiveReason = options.forcedTechnicianId
    ? options.detail?.reason || 'Asignación manual'
    : decision.assignmentReason;
  const updated = await pool.query(
    `UPDATE tickets SET tecnico_id=$1,tecnico_nombre=$2,asignacion_estado='Asignado',
            assignment_status='assigned',assignment_reason=$3,updated_at=NOW()
     WHERE id=$4 RETURNING *`,
    [selected.id, selected.full_name, effectiveReason, ticketId]
  );
  await client.zRem(WAITING_KEY, String(ticketId))
    .catch((error) => console.error('No se pudo retirar ticket asignado de Redis:', error.message));
  const decisionMetadata = {
    ...(options.detail || {}),
    selected_technician_id: selected.id,
    selected_technician_name: selected.full_name,
    assignment_reason: effectiveReason,
    skipped_candidates: decision.skippedCandidates,
    active_load: selected.active_load,
    max_active_tickets: selected.max_active_tickets,
  };
  await pool.query(
    `INSERT INTO historial_asignaciones(ticket_id,tecnico_id,asignado_por,tipo,detalle)
     VALUES($1,$2,$3,$4,$5::jsonb)`,
    [
      ticketId,
      selected.id,
      options.assignedBy || null,
      options.forcedTechnicianId ? 'Forzada' : 'Automática',
      JSON.stringify(decisionMetadata),
    ]
  );
  const priorityKey = String(ticket.prioridad).toLowerCase();
  await createNotification({
    userId: selected.id,
    ticketId,
    type: options.forcedTechnicianId ? 'ticket_reassigned' : 'ticket_assigned',
    severity: priorityKey.includes('crit') ? 'critical' : priorityKey.includes('alt') ? 'warning' : 'info',
    title: options.forcedTechnicianId ? 'Ticket reasignado' : 'Nuevo ticket asignado',
    body: updated.rows[0].titulo_tecnico || updated.rows[0].titulo,
    payload: { prioridad: ticket.prioridad, forced: Boolean(options.forcedTechnicianId), detail: options.detail || {} },
  }).catch(() => {});
  emitToUser(selected.id, 'ticket:assigned', updated.rows[0]);
  if (priorityKey.includes('crit') || priorityKey.includes('alt')) {
    if (priorityKey.includes('crit')) emitToUser(selected.id, 'critical:alert', updated.rows[0]);
    if (priorityKey.includes('crit')) {
      await createNotification({
        userId: selected.id,
        ticketId,
        type: 'ticket_critical',
        severity: 'critical',
        title: 'Ticket crítico asignado',
        body: updated.rows[0].titulo_tecnico || updated.rows[0].titulo,
        payload: { prioridad: ticket.prioridad },
      }).catch(() => {});
    }
    const { sendPushToUser } = require('../routes/push.routes');
    sendPushToUser(selected.id, { title: priorityKey.includes('crit') ? 'Ticket crítico asignado' : 'Ticket de alta prioridad', body: updated.rows[0].titulo_tecnico, ticketId }).catch(() => {});
  }
  return {
    assigned: true,
    assignment_reason: effectiveReason,
    ticket: updated.rows[0],
    decision: decisionMetadata,
  };
  } catch (error) {
    if (lockStarted) await assignmentLock.query('ROLLBACK').catch(() => {});
    lockStarted = false;
    throw error;
  } finally {
    if (lockStarted) await assignmentLock.query('COMMIT').catch(() => {});
    assignmentLock.release();
  }
}

async function processWaitingQueue() {
  const ids = await client.zRange(WAITING_KEY, 0, -1);
  for (const id of ids) {
    await assignTicket(Number(id));
  }
}

async function reprocessUnassignedTickets({ categoryId = null } = {}) {
  const params = [];
  let categoryFilter = '';
  if (categoryId) {
    params.push(Number(categoryId));
    categoryFilter = `AND categoria_id=$${params.length}`;
  }
  const pending = await pool.query(
    `SELECT id FROM tickets
     WHERE tecnico_id IS NULL
       AND estado IN ('Abierto','En Progreso','En Espera','Planificado')
       ${categoryFilter}
     ORDER BY created_at,id`,
    params
  );
  const results = [];
  for (const row of pending.rows) {
    results.push({ ticketId: row.id, ...(await assignTicket(row.id)) });
  }
  return results;
}

async function repairDuplicateHighPriorityAssignments({ assignedBy = null } = {}) {
  const rows = await pool.query(
    `SELECT id,tecnico_id,tecnico_nombre,estado,prioridad,fecha_inicio,t_captura,created_at
     FROM tickets
     WHERE tecnico_id IS NOT NULL
       AND estado='En Progreso'
       AND prioridad IN ('Alta','Crítica')
     ORDER BY tecnico_id,COALESCE(fecha_inicio,t_captura,created_at),id`
  );
  const duplicates = redundantHighPriorityTickets(rows.rows);
  const repaired = [];
  for (const duplicate of duplicates) {
    const detached = await pool.query(
      `UPDATE tickets
       SET tecnico_id=NULL,tecnico_nombre=NULL,
           asignacion_estado='Bolsa de Espera',assignment_status='waiting_pool',
           assignment_reason='TECHNICIAN_BUSY_HIGH_PRIORITY',updated_at=NOW()
       WHERE id=$1 AND tecnico_id=$2 AND estado='En Progreso'
       RETURNING *`,
      [duplicate.id, duplicate.tecnico_id]
    );
    if (!detached.rows[0]) continue;
    await pool.query(
      `INSERT INTO historial_asignaciones(ticket_id,asignado_por,tipo,detalle)
       VALUES($1,$2,'Bolsa de Espera',$3::jsonb)`,
      [
        duplicate.id,
        assignedBy,
        JSON.stringify({
          assignment_reason: 'TECHNICIAN_BUSY_HIGH_PRIORITY',
          previous_technician_id: duplicate.tecnico_id,
          repair: 'DUPLICATE_HIGH_PRIORITY_IN_PROGRESS',
        }),
      ]
    );
    await client.zAdd(WAITING_KEY, [{ score: Date.now(), value: String(duplicate.id) }])
      .catch(() => {});
    const reassignment = await assignTicket(duplicate.id);
    repaired.push({
      id: duplicate.id,
      previous_technician_id: duplicate.tecnico_id,
      repairs: ['DUPLICATE_HIGH_PRIORITY_IN_PROGRESS'],
      reassignment,
    });
  }
  return repaired;
}

module.exports = {
  WAITING_KEY,
  activeTechnicians,
  assignTicket,
  processWaitingQueue,
  reprocessUnassignedTickets,
  assignmentDecision,
  repairDuplicateHighPriorityAssignments,
};
