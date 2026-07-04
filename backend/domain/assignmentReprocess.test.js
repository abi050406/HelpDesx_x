const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldReprocessTicket } = require('./assignmentReprocess');

test('guardar matriz de Accesos incluye ticket #46 en el reproceso', () => {
  assert.equal(shouldReprocessTicket({
    id: 46,
    categoria_id: 187,
    estado: 'Abierto',
    tecnico_id: null,
  }, 187), true);
});
