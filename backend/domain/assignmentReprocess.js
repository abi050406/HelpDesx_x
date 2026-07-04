function shouldReprocessTicket(ticket, categoryId) {
  return Number(ticket?.categoria_id) === Number(categoryId)
    && ticket?.tecnico_id == null
    && ['Abierto', 'En Progreso', 'En Espera', 'Planificado'].includes(ticket?.estado);
}

module.exports = { shouldReprocessTicket };
