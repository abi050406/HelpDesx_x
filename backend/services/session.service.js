const { client } = require('../redis');

const SESSION_PREFIX = 'helpdesk:session:';
const USER_SESSION_PREFIX = 'helpdesk:user-sessions:';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

async function createSession(token, user) {
  await client.set(`${SESSION_PREFIX}${token}`, JSON.stringify({ user, createdAt: Date.now() }), { EX: SESSION_TTL_SECONDS });
  await client.sAdd(`${USER_SESSION_PREFIX}${user.id}`, token);
  await client.expire(`${USER_SESSION_PREFIX}${user.id}`, SESSION_TTL_SECONDS);
}

async function getSession(token) {
  if (!token) return null;
  const value = await client.get(`${SESSION_PREFIX}${token}`);
  return value ? JSON.parse(value) : null;
}

async function deleteSession(token) {
  if (!token) return;
  const session = await getSession(token);
  await client.del(`${SESSION_PREFIX}${token}`);
  if (session?.user?.id) await client.sRem(`${USER_SESSION_PREFIX}${session.user.id}`, token);
}

async function requirePasswordChangeForUser(userId) {
  const setKey = `${USER_SESSION_PREFIX}${userId}`;
  const tokens = await client.sMembers(setKey);
  for (const token of tokens) {
    const session = await getSession(token);
    if (!session) {
      await client.sRem(setKey, token);
      continue;
    }
    session.user.mustChangePassword = true;
    await client.set(`${SESSION_PREFIX}${token}`, JSON.stringify(session), { EX: SESSION_TTL_SECONDS });
  }
}

module.exports = { createSession, getSession, deleteSession, requirePasswordChangeForUser };
