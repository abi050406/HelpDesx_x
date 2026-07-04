const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStars, validateComment } = require('./rating.service');

test('valida estrellas enteras entre 1 y 5', () => {
  assert.equal(validateStars(1), 1);
  assert.equal(validateStars('5'), 5);
  assert.throws(() => validateStars(0), /entre 1 y 5/);
  assert.throws(() => validateStars(6), /entre 1 y 5/);
  assert.throws(() => validateStars(3.5), /entre 1 y 5/);
});

test('normaliza comentario y permite validar solo obligatorio', () => {
  assert.equal(validateComment('  Ok  ', 1), 'Ok');
  assert.equal(validateComment('  !  ', 1), '!');
  assert.throws(() => validateComment('      ', 1), /obligatorio/);
});

test('exige longitud mínima real cuando se solicita', () => {
  assert.equal(validateComment('  Respuesta   clara del asociado  ', 10), 'Respuesta clara del asociado');
  assert.throws(() => validateComment('      ', 10), /al menos 10/);
  assert.throws(() => validateComment('!!!!!!!!!', 5), /texto/);
  assert.throws(() => validateComment('corto', 10), /al menos 10/);
});
