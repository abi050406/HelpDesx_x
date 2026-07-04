const test = require('node:test');
const assert = require('node:assert/strict');
const { netResolutionSeconds } = require('./netResolutionTime');

test('resta todas las pausas del tiempo bruto', () => {
  const value = netResolutionSeconds('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z', [
    { t_pausa_inicio: '2026-01-01T10:10:00Z', t_pausa_fin: '2026-01-01T10:20:00Z' },
    { t_pausa_inicio: '2026-01-01T10:40:00Z', t_pausa_fin: '2026-01-01T10:50:00Z' },
  ]);
  assert.equal(value, 2400);
});
