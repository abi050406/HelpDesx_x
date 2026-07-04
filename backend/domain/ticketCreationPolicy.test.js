const test = require('node:test');
const assert = require('node:assert/strict');
const { ticketCreationConflict } = require('./ticketCreationPolicy');

test('ticket activo duplicado queda bloqueado', () => {
  const conflict = ticketCreationConflict([{ id: 1, estado: 'En Progreso', categoria: 'Redes' }], 'Software');
  assert.equal(conflict.code, 'ACTIVE_TICKET_EXISTS');
});

test('ticket planificado no bloquea salvo misma categoría o choque horario', () => {
  const now = Date.parse('2026-06-30T12:00:00Z');
  const distant = [{ id: 1, estado: 'Planificado', categoria: 'Redes', fecha_planificada: '2026-07-02T12:00:00Z', sla_objetivo_minutos: 60 }];
  assert.equal(ticketCreationConflict(distant, 'Software', now), null);
  assert.equal(ticketCreationConflict(distant, 'Redes', now).code, 'PLANNED_SAME_CATEGORY_EXISTS');
  const collision = [{ ...distant[0], categoria: 'Redes', fecha_planificada: '2026-06-30T12:10:00Z' }];
  assert.equal(ticketCreationConflict(collision, 'Software', now).code, 'PLANNED_TIME_CONFLICT');
});
