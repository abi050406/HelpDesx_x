const test = require('node:test');
const assert = require('node:assert/strict');
const { passwordChangeGate } = require('./accessPolicy');

test('usuario con mustChangePassword queda bloqueado salvo cambio y logout', () => {
  const user = { mustChangePassword: true };
  assert.notEqual(passwordChangeGate(user, '/api/tickets', '/'), null);
  assert.equal(passwordChangeGate(user, '/api/auth', '/change-password'), null);
  assert.equal(passwordChangeGate(user, '/api/auth', '/logout'), null);
  assert.equal(passwordChangeGate({ mustChangePassword: false }, '/api/tickets', '/'), null);
});
