function selectTechnician({ technicians, conflicts = [], categoryRules = [], associateId, categoryId }) {
  const eligible = technicians.filter((tech) => {
    if (tech.estado !== 'Activo' || tech.is_active === false || tech.exclusion_corporativa) return false;
    if (Number(tech.active_load || 0) >= Number(tech.max_active_tickets || 5)) return false;
    if (conflicts.some((item) => item.asociado_id === associateId && item.tecnico_id === tech.id && item.activo !== false)) return false;
    const rule = categoryRules.find((item) => item.tecnico_id === tech.id && item.categoria_id === categoryId);
    return rule && !rule.excluido;
  }).map((tech) => ({ ...tech, prioridad_skill: categoryRules.find((item) => item.tecnico_id === tech.id && item.categoria_id === categoryId).prioridad_skill }));
  eligible.sort((a, b) => a.prioridad_skill - b.prioridad_skill || new Date(a.disponible_desde) - new Date(b.disponible_desde));
  return eligible[0] || null;
}

module.exports = { selectTechnician };
