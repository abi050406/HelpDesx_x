const test = require('node:test');
const assert = require('node:assert/strict');
const { redundantHighPriorityTickets } = require('./highPriorityRepair');

test('reparación conserva el Alta más antiguo y redistribuye los demás', () => {
  const duplicates = redundantHighPriorityTickets([
    { id: 47, tecnico_id: 478, estado: 'En Progreso', prioridad: 'Alta', fecha_inicio: '2026-07-01T10:00:00Z' },
    { id: 48, tecnico_id: 478, estado: 'En Progreso', prioridad: 'Alta', fecha_inicio: '2026-07-01T11:00:00Z' },
    { id: 49, tecnico_id: 3, estado: 'En Progreso', prioridad: 'Media', fecha_inicio: '2026-07-01T09:00:00Z' },
  ]);
  assert.deepEqual(duplicates.map((ticket) => ticket.id), [48]);
});
