const test = require('node:test');
const assert = require('node:assert/strict');
const { validateManualAssignment } = require('./manualAssignment');

test('admin asigna manualmente un técnico activo aunque no sea prioridad 1', () => {
  assert.equal(validateManualAssignment({
    actorRole: 'admin',
    technician: { id: 478, role: 'tecnico', is_active: true },
  }), null);
});

test('asignación manual rechaza técnico inactivo', () => {
  assert.equal(validateManualAssignment({
    actorRole: 'admin',
    technician: { id: 478, role: 'tecnico', is_active: false },
  }).code, 'INVALID_TECHNICIAN');
});
