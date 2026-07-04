const test = require('node:test');
const assert = require('node:assert/strict');
const { TICKET_STATES, normalizeTicketState, canTransition } = require('./ticketState');

test('normaliza aliases de estados al catálogo único', () => {
  assert.equal(normalizeTicketState('nuevo'), TICKET_STATES.OPEN);
  assert.equal(normalizeTicketState('EN_PROGRESO'), TICKET_STATES.IN_PROGRESS);
  assert.equal(normalizeTicketState('Planificada'), TICKET_STATES.PLANNED);
});

test('ticket resuelto acepta cierre, reapertura e intento idempotente', () => {
  assert.equal(canTransition('Resuelto', 'Cerrado'), true);
  assert.equal(canTransition('Resuelto', 'En Progreso'), true);
  assert.equal(canTransition('Resuelto', 'Resuelto'), true);
  assert.equal(canTransition('Resuelto', 'En Espera'), false);
});

test('cerrado es terminal y rechazado solo puede ser modificado por admin', () => {
  assert.equal(canTransition('Cerrado', 'En Progreso'), false);
  assert.equal(canTransition('Rechazado', 'En Progreso'), false);
  assert.equal(canTransition('Rechazado', 'En Progreso', { role: 'admin' }), true);
});
