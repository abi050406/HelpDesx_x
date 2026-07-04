const test = require('node:test');
const assert = require('node:assert/strict');
const { canManageChat, canAccessChat, canAddChatMember, validateChatMessage } = require('./chatPolicy');

test('solo admin administra grupos y miembros', () => {
  assert.equal(canManageChat('admin'), true);
  assert.equal(canManageChat('tech'), false);
  assert.equal(canManageChat('associate'), false);
});

test('admin crea grupo y puede agregar técnico o asociado', () => {
  assert.equal(canManageChat('admin'), true);
  for (const userRole of ['tech', 'associate', 'admin']) {
    assert.equal(canAddChatMember('admin', userRole), true);
  }
});

test('técnico y asociado no pueden agregar miembros', () => {
  assert.equal(canManageChat('tech'), false);
  assert.equal(canManageChat('associate'), false);
});

test('técnico y asociado solo acceden como miembros activos', () => {
  assert.equal(canAccessChat('tech', true), true);
  assert.equal(canAccessChat('associate', true), true);
  assert.equal(canAccessChat('tech', false), false);
  assert.equal(canAccessChat('associate', false), false);
});

test('admin accede a cualquier grupo', () => {
  assert.equal(canAccessChat('admin', false), true);
});

test('usuario no miembro no puede leer ni enviar mensajes', () => {
  assert.equal(canAccessChat('tech', false), false);
  assert.equal(canAccessChat('associate', false), false);
});

test('admin envía en cualquier grupo y miembro envía en su grupo', () => {
  assert.equal(canAccessChat('admin', false), true);
  assert.equal(canAccessChat('tech', true), true);
  assert.equal(canAccessChat('associate', true), true);
});

test('valida contenido real y límite del mensaje', () => {
  assert.equal(validateChatMessage('  hola  ').value, 'hola');
  assert.match(validateChatMessage('   ').error, /obligatorio/);
  assert.match(validateChatMessage('x'.repeat(2001)).error, /2000/);
});
