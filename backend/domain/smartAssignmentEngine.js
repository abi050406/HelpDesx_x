const PRIORITY_VALUES = Object.freeze({
  critica: 4,
  alta: 3,
  media: 2,
  baja: 1,
});

const REASON_MESSAGES = Object.freeze({
  TECHNICIAN_BUSY_HIGH_PRIORITY: 'El técnico ya atiende un ticket de alta prioridad o crítica.',
  INACTIVE_TECHNICIAN: 'El técnico está inactivo.',
  NO_ACTIVE_PRESENCE: 'El técnico no tiene presencia Activo.',
  TECHNICIAN_AT_CAPACITY: 'El técnico alcanzó su capacidad máxima.',
  SLA_RISK: 'El técnico tiene tickets vencidos por SLA.',
  PLANNED_TIME_CONFLICT: 'El técnico tiene un conflicto de horario planificado.',
  EXCLUDED_FROM_CATEGORY: 'El técnico está excluido de la categoría.',
  ASSOCIATE_CONFLICT: 'Existe un conflicto entre asociado y técnico.',
  CORPORATE_EXCLUSION: 'El técnico tiene una exclusión corporativa.',
});

function priorityValue(value) {
  const key = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return PRIORITY_VALUES[key] || 1;
}

function evaluateCandidate(candidate, { incomingPriorityValue = 1 } = {}) {
  const reasons = [];
  if (incomingPriorityValue >= PRIORITY_VALUES.alta
      && Number(candidate.high_critical_in_progress || 0) > 0) {
    reasons.push('TECHNICIAN_BUSY_HIGH_PRIORITY');
  }
  if (candidate.is_active === false) reasons.push('INACTIVE_TECHNICIAN');
  if (candidate.exclusion_corporativa === true) reasons.push('CORPORATE_EXCLUSION');
  if (candidate.presence_estado !== 'Activo') reasons.push('NO_ACTIVE_PRESENCE');
  if (Number(candidate.active_load || 0) >= Number(candidate.max_active_tickets || 5)) {
    reasons.push('TECHNICIAN_AT_CAPACITY');
  }
  if (Number(candidate.overdue_sla || 0) > 0) reasons.push('SLA_RISK');
  if (candidate.planned_conflict === true) reasons.push('PLANNED_TIME_CONFLICT');
  if (candidate.excluido === true) reasons.push('EXCLUDED_FROM_CATEGORY');
  if (candidate.has_associate_conflict === true) reasons.push('ASSOCIATE_CONFLICT');
  return {
    ...candidate,
    prioridad_asignacion: Number(candidate.prioridad_asignacion ?? candidate.prioridad_skill ?? 99),
    active_load: Number(candidate.active_load || 0),
    high_critical_in_progress: Number(candidate.high_critical_in_progress || 0),
    overdue_sla: Number(candidate.overdue_sla || 0),
    max_active_tickets: Number(candidate.max_active_tickets || 5),
    elegible: reasons.length === 0,
    eligible: reasons.length === 0,
    reason_codes: reasons,
    reason_code: reasons[0] || null,
    reason_message: reasons[0] ? REASON_MESSAGES[reasons[0]] || reasons[0] : null,
    motivo: reasons.length ? reasons.join(', ') : 'ELIGIBLE',
  };
}

function assignmentFailureReason(evaluated, ruleCount = evaluated.length) {
  if (!Number(ruleCount)) return 'NO_ASSIGNMENT_RULE';
  if (evaluated.every((item) => item.reason_codes.includes('TECHNICIAN_BUSY_HIGH_PRIORITY'))) return 'TECHNICIANS_BUSY_HIGH_PRIORITY';
  if (evaluated.every((item) => item.reason_codes.includes('NO_ACTIVE_PRESENCE'))) return 'NO_ACTIVE_PRESENCE';
  if (evaluated.every((item) => item.reason_codes.includes('TECHNICIAN_AT_CAPACITY'))) return 'TECHNICIANS_AT_CAPACITY';
  if (evaluated.every((item) => item.reason_codes.includes('SLA_RISK'))) return 'SLA_RISK';
  return 'NO_ELIGIBLE_TECHNICIAN';
}

function lastAssignmentTime(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function compareCandidates(a, b) {
  return a.prioridad_asignacion - b.prioridad_asignacion
    || Number(b.elegible) - Number(a.elegible)
    || a.active_load - b.active_load
    || a.high_critical_in_progress - b.high_critical_in_progress
    || a.overdue_sla - b.overdue_sla
    || lastAssignmentTime(a.ultima_asignacion) - lastAssignmentTime(b.ultima_asignacion)
    || Number(a.id) - Number(b.id);
}

function selectSmartTechnician(candidates, {
  ruleCount = candidates.length,
  incomingPriorityValue = 1,
} = {}) {
  const evaluated = candidates
    .map((candidate) => evaluateCandidate(candidate, { incomingPriorityValue }))
    .sort(compareCandidates);
  const selected = evaluated.find((candidate) => candidate.elegible) || null;
  const skipped = evaluated
    .filter((candidate) => !selected || Number(candidate.id) !== Number(selected.id))
    .map((candidate) => {
      let motivo = candidate.motivo;
      let reasonCodes = candidate.reason_codes;
      if (selected && candidate.elegible) {
        if (candidate.prioridad_asignacion > selected.prioridad_asignacion) {
          motivo = 'LOWER_MATRIX_PRIORITY';
        } else if (candidate.active_load > selected.active_load) {
          motivo = 'HIGHER_ACTIVE_LOAD';
        } else {
          motivo = 'NEWER_LAST_ASSIGNMENT_OR_TIE_BREAK';
        }
        reasonCodes = [motivo];
      }
      return {
        technician_id: candidate.id,
        technician_name: candidate.full_name,
        prioridad_asignacion: candidate.prioridad_asignacion,
        motivo,
        reason_codes: reasonCodes,
      };
    });
  const skippedHigherPriority = selected
    ? evaluated.filter((candidate) =>
      candidate.prioridad_asignacion < selected.prioridad_asignacion && !candidate.elegible)
    : [];
  const assignmentReason = selected
    ? skippedHigherPriority.length
      ? `Se saltó prioridad ${skippedHigherPriority[0].prioridad_asignacion} por técnico ocupado/saturado/SLA`
      : 'Asignación automática por prioridad, disponibilidad y carga'
    : assignmentFailureReason(evaluated, ruleCount);
  return { selected, candidates: evaluated, skippedCandidates: skipped, assignmentReason };
}

module.exports = {
  PRIORITY_VALUES,
  priorityValue,
  evaluateCandidate,
  selectSmartTechnician,
  assignmentFailureReason,
  REASON_MESSAGES,
};
