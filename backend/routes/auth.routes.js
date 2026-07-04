const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { setTechnicianPresence } = require('../services/presence.service');
const { createSession, getSession, deleteSession } = require('../services/session.service');
const { passwordChangeGate } = require('../domain/accessPolicy');

const router = express.Router();

const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEYLEN = 64;
const PASSWORD_DIGEST = 'sha512';

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto
    .pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, PASSWORD_DIGEST)
    .toString('hex');
  return `pbkdf2_${PASSWORD_DIGEST}$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  try {
    const [algorithm, iterations, salt, originalHash] = String(storedHash || '').split('$');
    const digest = algorithm.replace('pbkdf2_', '');
    const calculated = crypto
      .pbkdf2Sync(String(password), salt, Number(iterations), Buffer.from(originalHash, 'hex').length, digest)
      .toString('hex');

    return crypto.timingSafeEqual(Buffer.from(calculated, 'hex'), Buffer.from(originalHash, 'hex'));
  } catch (error) {
    return false;
  }
}

function publicUser(row) {
  const roleMap = { tecnico: 'tech', asociado: 'associate', admin: 'admin' };
  return {
    id: row.id,
    username: row.username,
    name: row.full_name,
    role: roleMap[row.role] || row.role,
    databaseRole: row.role,
    roleLabel: row.role_label,
    department: row.department,
    avatar: row.avatar || '👤',
    mustChangePassword: Boolean(row.must_change_password),
  };
}

let schemaReady = false;
async function ensureAuthSchema() {
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(80) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name VARCHAR(140) NOT NULL,
      role VARCHAR(30) NOT NULL CHECK (role IN ('admin', 'tecnico', 'asociado')),
      role_label VARCHAR(80) NOT NULL,
      department VARCHAR(80),
      avatar VARCHAR(12),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;`);

  const seedUsers = [
    ['bryan.mercado', 'Plano2026*', 'Bryan Mercado', 'admin', 'Administrador TI', 'TI', '👨‍💻'],
    ['juan.perez', 'Tech2026*', 'Juan Pérez', 'tecnico', 'Técnico de Soporte', 'TI', '👨'],
    ['roberto.sequeira', 'Tech2026*', 'Roberto Sequeira', 'tecnico', 'Técnico de Soporte', 'TI', '👨‍🔧'],
    ['ana.lopez', 'Asociado2026*', 'Ana López', 'asociado', 'Asociado', 'Contabilidad', '👩'],
  ];

  for (const user of seedUsers) {
    const [username, password, fullName, role, roleLabel, department, avatar] = user;
    await pool.query(
      `
      INSERT INTO app_users (username, password_hash, full_name, role, role_label, department, avatar)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (username)
      DO UPDATE SET
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        role_label = EXCLUDED.role_label,
        department = EXCLUDED.department,
        avatar = EXCLUDED.avatar,
        is_active = TRUE,
        updated_at = NOW();
      `,
      [normalizeUsername(username), hashPassword(password), fullName, role, roleLabel, department, avatar]
    );
  }


  await pool.query(`
    DELETE FROM app_users
    WHERE username = 'admin.ti';
  `);

  schemaReady = true;
}

async function requireAuth(req, res, next) {
  await ensureAuthSchema();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = await getSession(token);

  if (!session) {
    return res.status(req.adminRoute ? 403 : 401).json({ error: 'Sesión inválida o expirada.' });
  }

  req.user = session.user;
  req.token = token;
  const currentUser = await pool.query(
    `SELECT is_active,must_change_password FROM app_users WHERE id=$1`,
    [req.user.id]
  );
  if (!currentUser.rows[0]?.is_active) {
    await deleteSession(token);
    return res.status(401).json({ error: 'Usuario inactivo o inexistente.' });
  }
  req.user.mustChangePassword = Boolean(currentUser.rows[0].must_change_password);
  const passwordGate = passwordChangeGate(req.user, req.baseUrl, req.path);
  if (passwordGate) {
    return res.status(403).json({
      success: false,
      ...passwordGate,
    });
  }
  return next();
}

router.use(async (req, res, next) => {
  try {
    await ensureAuthSchema();
    next();
  } catch (error) {
    console.error('❌ Error preparando autenticación:', error.message);
    res.status(500).json({ error: 'No se pudo preparar el módulo de autenticación.' });
  }
});

router.post('/login', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, password_hash, full_name, role, role_label, department, avatar, is_active, must_change_password
       FROM app_users
       WHERE username = $1
       LIMIT 1;`,
      [username]
    );

    const dbUser = result.rows[0];

    if (!dbUser || !dbUser.is_active || !verifyPassword(password, dbUser.password_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const user = publicUser(dbUser);
    const token = crypto.randomBytes(48).toString('hex');

    await createSession(token, user);

    if (user.role === 'tech') await setTechnicianPresence(user.id, 'Activo');

    return res.json({
      message: 'Inicio de sesión correcto.',
      token,
      user,
    });
  } catch (error) {
    console.error('❌ Error en POST /auth/login:', error.message);
    return res.status(500).json({ error: 'Error interno al iniciar sesión.' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (!currentPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'La contraseña actual y una nueva contraseña de al menos 8 caracteres son obligatorias.' });
  }
  try {
    const result = await pool.query(`SELECT password_hash FROM app_users WHERE id=$1 AND is_active=TRUE`, [req.user.id]);
    if (!result.rows[0] || !verifyPassword(currentPassword, result.rows[0].password_hash)) {
      return res.status(400).json({ success: false, code: 'INVALID_CURRENT_PASSWORD', error: 'La contraseña actual es incorrecta.' });
    }
    await pool.query(
      `UPDATE app_users SET password_hash=$1,must_change_password=FALSE,updated_at=NOW() WHERE id=$2`,
      [hashPassword(newPassword),req.user.id]
    );
    req.user.mustChangePassword = false;
    await createSession(req.token, req.user);
    res.json({ success: true });
  } catch (error) {
    console.error('Error cambiando contraseña:', error.message);
    res.status(500).json({ success: false, error: 'No se pudo cambiar la contraseña.' });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  await deleteSession(req.token);
  if (req.user.role === 'tech') {
    setTechnicianPresence(req.user.id, 'Fuera de Servicio', 'Cierre de sesión')
      .finally(() => res.json({ message: 'Sesión cerrada correctamente.' }));
    return;
  }
  res.json({ message: 'Sesión cerrada correctamente.' });
});

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.getSession = getSession;
module.exports.hashPassword = hashPassword;
module.exports.normalizeUsername = normalizeUsername;
module.exports.verifyPassword = verifyPassword;
module.exports.publicUser = publicUser;
