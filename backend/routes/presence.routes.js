const express = require('express');
const { requireAuth } = require('./auth.routes');
const { listTechnicianPresence, setTechnicianPresence } = require('../services/presence.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  if (!['tech', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Acceso restringido al equipo de TI.' });
  try {
    res.json(await listTechnicianPresence());
  } catch (error) {
    res.status(500).json({ error: 'No se pudo consultar la presencia técnica.' });
  }
});

router.put('/me', async (req, res) => {
  if (req.user.role !== 'tech') return res.status(403).json({ error: 'Solo un técnico puede actualizar su presencia.' });
  try {
    res.json(await setTechnicianPresence(req.user.id, req.body.estado, req.body.razon));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
