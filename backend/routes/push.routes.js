const express = require('express');
const webpush = require('web-push');
const pool = require('../db');
const { requireAuth } = require('./auth.routes');

const router = express.Router();
router.use(requireAuth);

function configured() { return process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY; }
router.get('/public-key', (_req, res) => configured() ? res.json({ publicKey: process.env.VAPID_PUBLIC_KEY }) : res.status(503).json({ error: 'VAPID no configurado.' }));
router.post('/subscriptions', async (req, res) => {
  if (!req.body?.endpoint) return res.status(400).json({ error: 'Suscripción inválida.' });
  await pool.query(`INSERT INTO web_push_subscriptions(usuario_id,endpoint,subscription) VALUES($1,$2,$3::jsonb) ON CONFLICT(endpoint) DO UPDATE SET usuario_id=EXCLUDED.usuario_id,subscription=EXCLUDED.subscription,updated_at=NOW()`, [req.user.id, req.body.endpoint, JSON.stringify(req.body)]);
  res.status(201).json({ message: 'Suscripción guardada.' });
});
router.delete('/subscriptions', async (req, res) => { await pool.query('DELETE FROM web_push_subscriptions WHERE endpoint=$1 AND usuario_id=$2', [req.body.endpoint, req.user.id]); res.status(204).end(); });

async function sendPushToUser(userId, payload) {
  if (!configured()) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:helpdesk@localhost', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const rows = await pool.query('SELECT id,subscription FROM web_push_subscriptions WHERE usuario_id=$1', [userId]);
  for (const row of rows.rows) {
    try { await webpush.sendNotification(row.subscription, JSON.stringify(payload)); }
    catch (error) { if ([404,410].includes(error.statusCode)) await pool.query('DELETE FROM web_push_subscriptions WHERE id=$1', [row.id]); }
  }
}

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
