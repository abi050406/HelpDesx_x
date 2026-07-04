const { normalizeTicketState, TICKET_STATES } = require('./ticketState');

function normalizeCategory(value) {
  return String(value || '').trim().toLowerCase();
}

function ticketCreationConflict(tickets, newCategory = '', now = Date.now()) {
  const active = tickets.find((ticket) => [
    TICKET_STATES.OPEN,
    TICKET_STATES.IN_PROGRESS,
    TICKET_STATES.WAITING,
    TICKET_STATES.RESOLVED,
  ].includes(normalizeTicketState(ticket.estado, { strict: false })));
  if (active) return { code: 'ACTIVE_TICKET_EXISTS', ticket: active };

  const planned = tickets.filter((ticket) =>
    normalizeTicketState(ticket.estado, { strict: false }) === TICKET_STATES.PLANNED);
  const sameCategory = planned.find((ticket) =>
    normalizeCategory(ticket.categoria) === normalizeCategory(newCategory));
  if (sameCategory) return { code: 'PLANNED_SAME_CATEGORY_EXISTS', ticket: sameCategory };

  const timeConflict = planned.find((ticket) => {
    const plannedAt = new Date(ticket.fecha_planificada).getTime();
    if (Number.isNaN(plannedAt)) return false;
    const sla = Number(ticket.sla_objetivo_minutos) || 60;
    return now >= plannedAt - 30 * 60 * 1000 && now <= plannedAt + sla * 60 * 1000;
  });
  return timeConflict ? { code: 'PLANNED_TIME_CONFLICT', ticket: timeConflict } : null;
}

module.exports = { ticketCreationConflict, normalizeCategory };
