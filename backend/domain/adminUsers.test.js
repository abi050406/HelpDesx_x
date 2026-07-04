const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFullName,
  usernameBase,
  validateCreateUser,
  deactivationError,
  duplicateUserCode,
} = require('./adminUsers');
const { hashPassword, verifyPassword, publicUser } = require('../routes/auth.routes');

const baseUser = {
  username: 'persona.prueba',
  full_name: 'Persona Prueba',
  role_label: 'Rol de prueba',
  department: 'Operaciones',
  password: 'Temporal2026*',
};

test('normaliza full_name para detectar nombres duplicados', () => {
  assert.equal(normalizeFullName('  Carlos   Rivera '), normalizeFullName('carlos rivera'));
});

test('no permite crear un username duplicado', () => {
  assert.equal(duplicateUserCode(true, false), 'USERNAME_EXISTS');
});

test('no permite crear un full_name duplicado', () => {
  assert.equal(duplicateUserCode(false, true), 'FULL_NAME_EXISTS');
});

test('normaliza username y permite sugerir sufijos para duplicados', () => {
  assert.equal(usernameBase('Ána  López!'), 'ana.lopez');
  const used = new Set(['ana.lopez', 'ana.lopez2']);
  let suffix = 2;
  let candidate = 'ana.lopez';
  while (used.has(candidate)) candidate = `ana.lopez${suffix++}`;
  assert.equal(candidate, 'ana.lopez3');
});

for (const role of ['admin', 'tech', 'associate']) {
  test(`valida creación de usuario con rol ${role}`, () => {
    assert.equal(validateCreateUser({ ...baseUser, role }), null);
  });
}

test('rechaza datos obligatorios o contraseña corta al crear usuario', () => {
  assert.match(validateCreateUser({ ...baseUser, role: 'tech', password: 'corta' }), /8 caracteres/);
});

test('reset de contraseña puede verificarse con el hash actual', () => {
  const hash = hashPassword('NuevaTemporal2026*');
  assert.equal(verifyPassword('NuevaTemporal2026*', hash), true);
  assert.equal(verifyPassword('incorrecta', hash), false);
});

test('login expone mustChangePassword true y false', () => {
  assert.equal(publicUser({ role: 'asociado', must_change_password: true }).mustChangePassword, true);
  assert.equal(publicUser({ role: 'asociado', must_change_password: false }).mustChangePassword, false);
});

test('no permite eliminarse a sí mismo', () => {
  assert.deepEqual(
    deactivationError({ targetId: 4, actorId: 4, targetRole: 'admin', activeAdminCount: 2 }),
    { code: 'CANNOT_DELETE_SELF', error: 'No puedes eliminar tu propio usuario.' }
  );
});

test('no permite eliminar el último admin', () => {
  assert.deepEqual(
    deactivationError({ targetId: 4, actorId: 2, targetRole: 'admin', activeAdminCount: 1 }),
    { code: 'LAST_ADMIN', error: 'Debe existir al menos un administrador activo.' }
  );
});
