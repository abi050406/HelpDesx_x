const express = require('express');
const pool = require('../db');
const { requireAuth } = require('./auth.routes');
const { logAudit } = require('../services/audit.service');

const router = express.Router();

router.use(requireAuth, (req, res, next) => {
  if (!['admin', 'tech'].includes(req.user.role)) return res.status(403).json({ error: 'Wiki TI disponible solo para TI.' });
  return next();
});

router.get('/', async (req, res) => {
  const search = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const params = [];
  const where = ['activo = TRUE'];

  if (category) {
    params.push(category);
    where.push(`categoria = $${params.length}`);
  }

  if (search) {
    params.push(search);
    where.push(`(
      vector_indexacion @@ plainto_tsquery('spanish', $${params.length})
      OR titulo ILIKE '%' || $${params.length} || '%'
      OR contenido_solucion ILIKE '%' || $${params.length} || '%'
    )`);
  }

  const result = await pool.query(
    `SELECT id,titulo,contenido_solucion,caso_especial_id,categoria,etiquetas,created_by,created_at,updated_at,
            CASE WHEN $${params.length + 1}::text = '' THEN 0
              ELSE ts_rank(vector_indexacion, plainto_tsquery('spanish', $${params.length + 1}))
            END AS rank
     FROM wiki_ti
     WHERE ${where.join(' AND ')}
     ORDER BY rank DESC, updated_at DESC
     LIMIT 80`,
    [...params, search]
  );
  res.json(result.rows);
});

router.get('/:id', async (req, res) => {
  const result = await pool.query(
    `SELECT w.*, u.full_name created_by_name
     FROM wiki_ti w
     LEFT JOIN app_users u ON u.id = w.created_by
     WHERE w.id=$1 AND w.activo=TRUE`,
    [Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Artículo no encontrado.' });
  res.json(result.rows[0]);
});

router.post('/', async (req, res) => {
  const title = String(req.body.titulo || '').trim();
  const content = String(req.body.contenido_solucion || '').trim();
  const category = String(req.body.categoria || '').trim() || null;
  const tags = Array.isArray(req.body.etiquetas) ? req.body.etiquetas.map((tag) => String(tag).trim()).filter(Boolean) : [];
  const specialCaseId = req.body.caso_especial_id ? Number(req.body.caso_especial_id) : null;

  if (!title || !content) return res.status(400).json({ error: 'Título y solución son obligatorios.' });

  const result = await pool.query(
    `INSERT INTO wiki_ti(titulo,contenido_solucion,caso_especial_id,categoria,etiquetas,created_by)
     VALUES($1,$2,$3,$4,$5::text[],$6)
     RETURNING *`,
    [title, content, specialCaseId, category, tags, req.user.id]
  );
  await logAudit({ actorId: req.user.id, action: 'wiki.crear', entity: 'wiki_ti', entityId: result.rows[0].id, detail: { title, category, tags } });
  res.status(201).json(result.rows[0]);
});

router.put('/:id', async (req, res) => {
  const title = String(req.body.titulo || '').trim();
  const content = String(req.body.contenido_solucion || '').trim();
  const category = String(req.body.categoria || '').trim() || null;
  const tags = Array.isArray(req.body.etiquetas) ? req.body.etiquetas.map((tag) => String(tag).trim()).filter(Boolean) : [];
  const specialCaseId = req.body.caso_especial_id ? Number(req.body.caso_especial_id) : null;

  if (!title || !content) return res.status(400).json({ error: 'Título y solución son obligatorios.' });

  const result = await pool.query(
    `UPDATE wiki_ti
     SET titulo=$1, contenido_solucion=$2, caso_especial_id=$3, categoria=$4, etiquetas=$5::text[], updated_at=NOW()
     WHERE id=$6 AND activo=TRUE
     RETURNING *`,
    [title, content, specialCaseId, category, tags, Number(req.params.id)]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Artículo no encontrado.' });
  await logAudit({ actorId: req.user.id, action: 'wiki.actualizar', entity: 'wiki_ti', entityId: result.rows[0].id, detail: { title, category, tags } });
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query(`UPDATE wiki_ti SET activo=FALSE, updated_at=NOW() WHERE id=$1 AND activo=TRUE RETURNING id,titulo`, [Number(req.params.id)]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Artículo no encontrado.' });
  await logAudit({ actorId: req.user.id, action: 'wiki.eliminar', entity: 'wiki_ti', entityId: result.rows[0].id, detail: { title: result.rows[0].titulo } });
  res.status(204).end();
});

module.exports = router;
