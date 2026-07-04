function planTicketRepairs(ticket) {
  const repairs = [];
  const normalized = String(ticket.estado || '').toLowerCase().replace(/_/g, ' ');
  let nextState = ticket.estado;
  if (normalized === 'en progreso'
      && (ticket.fecha_resuelto || ticket.t_resolucion || ticket.has_technician_rating)) {
    nextState = 'Resuelto';
    repairs.push('STATE_TO_RESOLVED');
  }
  if (String(nextState).toLowerCase() === 'resuelto' && !ticket.fecha_resuelto) {
    repairs.push('RESOLVED_DATE_COMPLETED');
  }
  if (normalized === 'cerrado' && !ticket.fecha_cerrado) repairs.push('CLOSED_DATE_COMPLETED');

  const inactiveAssignment = Boolean(ticket.tecnico_id) && ticket.technician_is_active !== true;
  const terminal = ['resuelto', 'cerrado', 'rechazado'].includes(String(nextState).toLowerCase());
  if (inactiveAssignment) repairs.push(terminal ? 'INACTIVE_TECH_REVIEW' : 'INACTIVE_TECH_TO_WAITING');
  return { nextState, inactiveAssignment, terminal, repairs };
}

module.exports = { planTicketRepairs };
