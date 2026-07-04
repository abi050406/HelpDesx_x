function validateManualAssignment({ actorRole, technician }) {
  if (actorRole !== 'admin') return { code: 'ADMIN_REQUIRED', error: 'Se requiere rol administrador.' };
  if (!technician || technician.role !== 'tecnico' || technician.is_active !== true) {
    return { code: 'INVALID_TECHNICIAN', error: 'El técnico no existe o está inactivo.' };
  }
  return null;
}

module.exports = { validateManualAssignment };
