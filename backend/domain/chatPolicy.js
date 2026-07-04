function canManageChat(role) {
  return role === 'admin';
}

function canAccessChat(role, isActiveMember) {
  return role === 'admin' || isActiveMember === true;
}

function canAddChatMember(actorRole, targetRole) {
  return actorRole === 'admin'
    && ['admin', 'tecnico', 'tech', 'asociado', 'associate'].includes(targetRole);
}

function validateChatMessage(value) {
  const message = String(value ?? '').trim();
  if (!message) return { error: 'El mensaje es obligatorio.' };
  if (message.length > 2000) return { error: 'El mensaje no puede exceder 2000 caracteres.' };
  return { value: message };
}

module.exports = { canManageChat, canAccessChat, canAddChatMember, validateChatMessage };
