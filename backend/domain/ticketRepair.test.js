const test = require('node:test');
const assert = require('node:assert/strict');
const { planTicketRepairs } = require('./ticketRepair');

test('repair-states corrige ticket inconsistente', () => {
  const plan = planTicketRepairs({
    id: 43,
    estado: 'En Progreso',
    fecha_resuelto: null,
    t_resolucion: null,
    has_technician_rating: true,
    tecnico_id: 89,
    technician_is_active: true,
  });
  assert.equal(plan.nextState, 'Resuelto');
  assert.deepEqual(plan.repairs, ['STATE_TO_RESOLVED', 'RESOLVED_DATE_COMPLETED']);
});
