const test = require('node:test');
const assert = require('node:assert/strict');
const { assignmentReason } = require('./assignmentReason');

test('Accesos sin regla queda sin asignar con reason NO_ASSIGNMENT_RULE', () => {
  assert.equal(assignmentReason({ ruleCount: 0, activePresenceCount: 3, eligibleCount: 0 }), 'NO_ASSIGNMENT_RULE');
});

test('Accesos con regla activa tiene candidato asignable', () => {
  assert.equal(assignmentReason({ ruleCount: 1, activePresenceCount: 1, eligibleCount: 1 }), null);
});

test('técnico sin presencia activa no recibe tickets', () => {
  assert.equal(assignmentReason({ ruleCount: 1, activePresenceCount: 0, eligibleCount: 0 }), 'NO_ACTIVE_PRESENCE');
});
