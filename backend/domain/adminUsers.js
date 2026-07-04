const VALID_ROLES = new Set(['admin', 'tech', 'associate']);

function normalizeFullName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function usernameBase(fullName) {
  return normalizeFullName(fullName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.+/g, '.');
}

function validateCreateUser(body = {}) {
  const username = String(body.username || '').trim().toLowerCase();
  const fullName = String(body.full_name || '').trim().replace(/\s+/g, ' ');
  const role = String(body.role || '').trim();
  const roleLabel = String(body.role_label || '').trim();
  const department = String(body.department || '').trim();
  const password = String(body.password || '');
  if (!username) return 'El username es obligatorio.';
  if (!fullName) return 'El nombre completo es obligatorio.';
  if (!VALID_ROLES.has(role)) return 'El rol debe ser admin, tech o associate.';
  if (!roleLabel) return 'La etiqueta del rol es obligatoria.';
  if (!department) return 'El departamento es obligatorio.';
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  return null;
}

function deactivationError({ targetId, actorId, targetRole, activeAdminCount }) {
  if (Number(targetId) === Number(actorId)) {
    return { code: 'CANNOT_DELETE_SELF', error: 'No puedes eliminar tu propio usuario.' };
  }
  if (targetRole === 'admin' && Number(activeAdminCount) <= 1) {
    return { code: 'LAST_ADMIN', error: 'Debe existir al menos un administrador activo.' };
  }
  return null;
}

function duplicateUserCode(usernameExists, fullNameExists) {
  if (usernameExists) return 'USERNAME_EXISTS';
  if (fullNameExists) return 'FULL_NAME_EXISTS';
  return null;
}

module.exports = {
  VALID_ROLES,
  normalizeFullName,
  usernameBase,
  validateCreateUser,
  deactivationError,
  duplicateUserCode,
};
