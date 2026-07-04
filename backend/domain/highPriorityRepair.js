function redundantHighPriorityTickets(tickets) {
  const grouped = new Map();
  for (const ticket of tickets) {
    if (ticket.estado !== 'En Progreso' || !['Alta', 'Crítica'].includes(ticket.prioridad) || !ticket.tecnico_id) continue;
    if (!grouped.has(Number(ticket.tecnico_id))) grouped.set(Number(ticket.tecnico_id), []);
    grouped.get(Number(ticket.tecnico_id)).push(ticket);
  }
  const redundant = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => {
      const left = new Date(a.fecha_inicio || a.t_captura || a.created_at || 0).getTime();
      const right = new Date(b.fecha_inicio || b.t_captura || b.created_at || 0).getTime();
      return left - right || Number(a.id) - Number(b.id);
    });
    redundant.push(...group.slice(1));
  }
  return redundant;
}

module.exports = { redundantHighPriorityTickets };
