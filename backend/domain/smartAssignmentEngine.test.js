const test = require('node:test');
const assert = require('node:assert/strict');
const { selectSmartTechnician, priorityValue } = require('./smartAssignmentEngine');

const candidate = (overrides = {}) => ({
  id: 1,
  full_name: 'Prioridad Uno',
  prioridad_asignacion: 1,
  is_active: true,
  presence_estado: 'Activo',
  active_load: 0,
  max_active_tickets: 5,
  high_critical_in_progress: 0,
  overdue_sla: 0,
  planned_conflict: false,
  excluido: false,
  has_associate_conflict: false,
  ultima_asignacion: null,
  ...overrides,
});

test('prioridad 1 libre recibe ticket', () => {
  const result = selectSmartTechnician(
    [candidate(), candidate({ id: 2, prioridad_asignacion: 2 })],
    { incomingPriorityValue: 3 }
  );
  assert.equal(result.selected.id, 1);
});

test('convierte prioridad de ticket a escala numérica 4-1', () => {
  assert.deepEqual(
    ['Crítica', 'Alta', 'Media', 'Baja'].map(priorityValue),
    [4, 3, 2, 1]
  );
});

test('prioridad 1 ocupado con Alta en progreso se salta a prioridad 2', () => {
  const result = selectSmartTechnician([
    candidate({ high_critical_in_progress: 1 }),
    candidate({ id: 2, full_name: 'Prioridad Dos', prioridad_asignacion: 2 }),
  ], { incomingPriorityValue: 3 });
  assert.equal(result.selected.id, 2);
  assert.match(result.assignmentReason, /Se saltó prioridad 1/);
});

test('prioridad 1 saturado se salta a prioridad 2', () => {
  const result = selectSmartTechnician([
    candidate({ active_load: 5 }),
    candidate({ id: 2, prioridad_asignacion: 2 }),
  ]);
  assert.equal(result.selected.id, 2);
});

test('prioridad 1 con Alta en progreso no recibe otro ticket Alta', () => {
  const result = selectSmartTechnician([
    candidate({ high_critical_in_progress: 1 }),
  ], { incomingPriorityValue: 4 });
  assert.equal(result.selected, null);
  assert.equal(result.candidates[0].reason_code, 'TECHNICIAN_BUSY_HIGH_PRIORITY');
  assert.equal(
    result.candidates[0].reason_message,
    'El técnico ya atiende un ticket de alta prioridad o crítica.'
  );
});

test('prioridad 2 libre recibe ticket Alta al estar prioridad 1 bloqueado', () => {
  const result = selectSmartTechnician([
    candidate({ high_critical_in_progress: 1 }),
    candidate({ id: 2, prioridad_asignacion: 2 }),
  ], { incomingPriorityValue: 3 });
  assert.equal(result.selected.id, 2);
});

test('si todos tienen Alta o Crítica en progreso queda sin asignar', () => {
  const result = selectSmartTechnician([
    candidate({ high_critical_in_progress: 1 }),
    candidate({ id: 2, prioridad_asignacion: 2, high_critical_in_progress: 2 }),
  ], { incomingPriorityValue: 3 });
  assert.equal(result.selected, null);
  assert.equal(result.assignmentReason, 'TECHNICIANS_BUSY_HIGH_PRIORITY');
});

test('Baja y Media conservan balanceo aunque exista Alta en progreso', () => {
  const result = selectSmartTechnician([
    candidate({ high_critical_in_progress: 1, active_load: 1 }),
  ], { incomingPriorityValue: 2 });
  assert.equal(result.selected.id, 1);
});

test('empate en misma prioridad usa menor carga activa y luego asignación más antigua', () => {
  const result = selectSmartTechnician([
    candidate({ id: 1, active_load: 2 }),
    candidate({ id: 2, active_load: 1, ultima_asignacion: '2026-06-30T10:00:00Z' }),
    candidate({ id: 3, active_load: 1, ultima_asignacion: '2026-06-29T10:00:00Z' }),
  ]);
  assert.equal(result.selected.id, 3);
});

test('ticket queda en bolsa si todos están en break o fuera de servicio', () => {
  const result = selectSmartTechnician([
    candidate({ presence_estado: 'En Break' }),
    candidate({ id: 2, presence_estado: 'Fuera de Servicio' }),
  ]);
  assert.equal(result.selected, null);
  assert.equal(result.assignmentReason, 'NO_ACTIVE_PRESENCE');
});
