function passwordChangeGate(user, baseUrl, path) {
  if (!user?.mustChangePassword) return null;
  const allowed = baseUrl === '/api/auth' && ['/change-password', '/logout'].includes(path);
  return allowed ? null : {
    code: 'PASSWORD_CHANGE_REQUIRED',
    error: 'Debes cambiar tu contraseña antes de continuar.',
  };
}

module.exports = { passwordChangeGate };
