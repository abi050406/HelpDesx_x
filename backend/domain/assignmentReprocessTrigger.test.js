const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldReprocessAfter } = require('./assignmentReprocessTrigger');

test('cierre de ticket reprocesa bolsa', () => {
  assert.equal(shouldReprocessAfter('ticket_closed'), true);
});

test('guardar matriz reprocesa bolsa', () => {
  assert.equal(shouldReprocessAfter('matrix_saved'), true);
});
