const test = require('node:test');
const assert = require('node:assert/strict');
const { selectTechnician } = require('./assignmentEngine');

const technicians = [
  { id: 1, estado: 'Activo', disponible_desde: '2026-01-01T10:00:00Z' },
  { id: 2, estado: 'Activo', disponible_desde: '2026-01-01T09:00:00Z' },
  { id: 3, estado: 'En Break', disponible_desde: '2026-01-01T08:00:00Z' },
];
const rules = [{ tecnico_id: 1, categoria_id: 4, prioridad_skill: 1, excluido: false },{ tecnico_id: 2, categoria_id: 4, prioridad_skill: 1, excluido: false },{ tecnico_id: 3, categoria_id: 4, prioridad_skill: 1, excluido: false }];

test('descarta conflictos explícitos', () => assert.equal(selectTechnician({ technicians, categoryRules: rules, categoryId: 4, associateId: 9, conflicts: [{ asociado_id: 9, tecnico_id: 2 }] }).id, 1));
test('descarta restricciones de categoría', () => assert.equal(selectTechnician({ technicians, categoryRules: rules.map((r)=>r.tecnico_id===2?{...r,excluido:true}:r), categoryId: 4, associateId: 9 }).id, 1));
test('prioriza skill y desempata por mayor ocio', () => assert.equal(selectTechnician({ technicians, categoryRules: rules, categoryId: 4, associateId: 9 }).id, 2));
test('devuelve null para activar fallback sin candidatos', () => assert.equal(selectTechnician({ technicians: technicians.map((t)=>({...t,estado:'Fuera de Servicio'})), categoryRules: rules, categoryId: 4, associateId: 9 }), null));
test('técnico inactivo o sin capacidad no recibe tickets', () => {
  const candidates = [
    { id: 1, estado: 'Activo', is_active: false, active_load: 0, max_active_tickets: 5 },
    { id: 2, estado: 'Activo', is_active: true, active_load: 5, max_active_tickets: 5 },
    { id: 3, estado: 'Activo', is_active: true, active_load: 1, max_active_tickets: 5 },
  ];
  const categoryRules = candidates.map((tech, index) => ({
    tecnico_id: tech.id, categoria_id: 4, prioridad_skill: index + 1, excluido: false,
  }));
  assert.equal(selectTechnician({ technicians: candidates, categoryRules, categoryId: 4, associateId: 9 }).id, 3);
});
test('Accesos con regla activa asigna técnico', () => {
  const selected = selectTechnician({
    technicians: [{ id: 478, estado: 'Activo', is_active: true }],
    categoryRules: [{ tecnico_id: 478, categoria_id: 187, prioridad_skill: 1, excluido: false }],
    categoryId: 187,
    associateId: 4,
  });
  assert.equal(selected.id, 478);
});
test('técnico sin presencia activa no recibe tickets aunque tenga regla', () => {
  const selected = selectTechnician({
    technicians: [{ id: 478, estado: 'Fuera de Servicio', is_active: true }],
    categoryRules: [{ tecnico_id: 478, categoria_id: 187, prioridad_skill: 1, excluido: false }],
    categoryId: 187,
    associateId: 4,
  });
  assert.equal(selected, null);
});
