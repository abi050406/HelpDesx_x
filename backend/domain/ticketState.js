const TICKET_STATES = Object.freeze({
  OPEN: 'Abierto',
  IN_PROGRESS: 'En Progreso',
  WAITING: 'En Espera',
  PLANNED: 'Planificado',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
  REJECTED: 'Rechazado',
});

const STATE_ALIASES = new Map([
  ['abierto', TICKET_STATES.OPEN],
  ['nuevo', TICKET_STATES.OPEN],
  ['en progreso', TICKET_STATES.IN_PROGRESS],
  ['en proceso', TICKET_STATES.IN_PROGRESS],
  ['en espera', TICKET_STATES.WAITING],
  ['en espera global', TICKET_STATES.WAITING],
  ['planificado', TICKET_STATES.PLANNED],
  ['planificada', TICKET_STATES.PLANNED],
  ['resuelto', TICKET_STATES.RESOLVED],
  ['cerrado', TICKET_STATES.CLOSED],
  ['rechazado', TICKET_STATES.REJECTED],
]);

const TRANSITIONS = new Map([
  [TICKET_STATES.OPEN, new Set([TICKET_STATES.IN_PROGRESS, TICKET_STATES.WAITING, TICKET_STATES.PLANNED, TICKET_STATES.REJECTED])],
  [TICKET_STATES.IN_PROGRESS, new Set([TICKET_STATES.WAITING, TICKET_STATES.PLANNED, TICKET_STATES.RESOLVED, TICKET_STATES.REJECTED])],
  [TICKET_STATES.WAITING, new Set([TICKET_STATES.IN_PROGRESS, TICKET_STATES.PLANNED, TICKET_STATES.REJECTED])],
  [TICKET_STATES.PLANNED, new Set([TICKET_STATES.IN_PROGRESS, TICKET_STATES.WAITING, TICKET_STATES.RESOLVED, TICKET_STATES.REJECTED])],
  [TICKET_STATES.RESOLVED, new Set([TICKET_STATES.CLOSED, TICKET_STATES.IN_PROGRESS])],
  [TICKET_STATES.CLOSED, new Set()],
  [TICKET_STATES.REJECTED, new Set()],
]);

function stateKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeTicketState(value, { strict = true } = {}) {
  const normalized = STATE_ALIASES.get(stateKey(value));
  if (!normalized && strict) {
    const error = new Error(`Estado de ticket inválido: ${String(value || '')}.`);
    error.code = 'INVALID_TICKET_STATE';
    throw error;
  }
  return normalized || null;
}

function canTransition(from, to, { role = null } = {}) {
  const source = normalizeTicketState(from);
  const target = normalizeTicketState(to);
  if (source === target) return true;
  if (source === TICKET_STATES.REJECTED && role === 'admin') return true;
  return TRANSITIONS.get(source)?.has(target) === true;
}

function assertTransition(from, to, options = {}) {
  if (!canTransition(from, to, options)) {
    const error = new Error(`Transición no permitida: ${normalizeTicketState(from)} → ${normalizeTicketState(to)}.`);
    error.code = 'INVALID_STATE_TRANSITION';
    throw error;
  }
  return normalizeTicketState(to);
}

module.exports = { TICKET_STATES, normalizeTicketState, canTransition, assertTransition, stateKey };
