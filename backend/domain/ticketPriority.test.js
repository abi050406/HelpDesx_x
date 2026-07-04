const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePriority } = require('./ticketPriority');

test('clasifica un incidente crítico y conserva el SLA', () => {
  const result = calculatePriority('Redes', { scope: 5, connectivity: 4, business: 4 });
  assert.deepEqual(result, {
    priority: 'Crítica',
    score: 13,
    answers: { scope: 5, connectivity: 4, business: 4 },
    slaMinutes: 45,
  });
});

test('rechaza puntajes manipulados por el cliente', () => {
  assert.throws(
    () => calculatePriority('Software', { scope: 99, workaround: 3, business: 4 }),
    /Respuesta inválida/
  );
});

test('exige todas las respuestas de contexto', () => {
  assert.throws(() => calculatePriority('Hardware', { scope: 2 }), /Respuesta inválida o ausente/);
});
