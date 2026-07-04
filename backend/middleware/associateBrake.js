const pool = require('../db');

async function associateBrake(req, res, next) {
  if (req.user?.role !== 'associate') return next();
  const pending = await pool.query(`
    SELECT t.id FROM tickets t
    WHERE t.usuario_id=$1 AND LOWER(t.estado)='resuelto'
      AND NOT EXISTS (SELECT 1 FROM historial_calificaciones h WHERE h.ticket_id=t.id AND h.asociado_id=$1)
    ORDER BY t.t_resolucion NULLS LAST LIMIT 1;`, [req.user.id]);
  if (!pending.rows[0]) return next();
  return res.status(403).json({ error: 'Acceso denegado: posee evaluaciones pendientes.', pendingTicketId: pending.rows[0].id });
}

module.exports = { associateBrake };
