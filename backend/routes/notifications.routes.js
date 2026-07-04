const express = require('express');
const { requireAuth } = require('./auth.routes');
const {
  listNotifications,
  markNotificationRead,
  markNotificationSeen,
} = require('../services/notification.service');

const router = express.Router();
router.use(requireAuth);

function parseBoolean(value) {
  return String(value || '').toLowerCase() === 'true';
}

router.get('/', async (req, res) => {
  try {
    const requestedUserId = req.query.userId ? Number(req.query.userId) : null;
    const requestedUsername = req.query.username ? String(req.query.username).trim() : null;
    const isAdmin = req.user.role === 'admin';
    const userId = isAdmin ? requestedUserId : req.user.id;
    const username = isAdmin ? requestedUsername : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const notifications = await listNotifications({
      userId,
      username,
      onlyUnread: parseBoolean(req.query.onlyUnread),
      limit,
    });
    res.json({ success: true, notifications });
  } catch (error) {
    res.status(500).json({ success: false, error: 'No se pudieron consultar las notificaciones.' });
  }
});

router.post('/:id/read', async (req, res) => {
  const notificationId = Number(req.params.id);
  if (!notificationId) return res.status(400).json({ success: false, error: 'ID de notificación inválido.' });
  try {
    const notification = await markNotificationRead(notificationId, req.user.role === 'admin' ? null : req.user.id);
    if (!notification) return res.status(404).json({ success: false, error: 'Notificación no encontrada.' });
    res.json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ success: false, error: 'No se pudo marcar la notificación como leída.' });
  }
});

router.post('/:id/seen', async (req, res) => {
  const notificationId = Number(req.params.id);
  if (!notificationId) return res.status(400).json({ success: false, error: 'ID de notificación inválido.' });
  try {
    const notification = await markNotificationSeen(notificationId, req.user.role === 'admin' ? null : req.user.id);
    if (!notification) return res.status(404).json({ success: false, error: 'Notificación no encontrada.' });
    res.json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ success: false, error: 'No se pudo marcar la notificación como vista.' });
  }
});

module.exports = router;
