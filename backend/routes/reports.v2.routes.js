const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../db');
const { requireAuth } = require('./auth.routes');

const router = express.Router();
router.use(requireAuth, (req, res, next) => ['admin', 'tech'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Acceso restringido.' }));

function buildTicketFilters(req) {
  const params = [];
  const where = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (req.user.role === 'tech') add('tecnico_id = ?', req.user.id);
  if (req.query.start) add('t_apertura >= ?::timestamptz', req.query.start);
  if (req.query.end) add('t_apertura < (?::date + INTERVAL \'1 day\')', req.query.end);
  if (req.query.technicianId && req.user.role === 'admin') add('tecnico_id = ?', Number(req.query.technicianId));
  if (req.query.category) add('categoria = ?', String(req.query.category));
  if (req.query.priority) add('LOWER(prioridad) = LOWER(?)', String(req.query.priority));
  if (req.query.sla === 'met') where.push('(duracion_neta_segundos IS NOT NULL AND sla_objetivo_minutos IS NOT NULL AND duracion_neta_segundos <= sla_objetivo_minutos * 60)');
  if (req.query.sla === 'missed') where.push('(duracion_neta_segundos IS NOT NULL AND sla_objetivo_minutos IS NOT NULL AND duracion_neta_segundos > sla_objetivo_minutos * 60)');

  return { params, whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

async function metrics(req) {
  const { params, whereSql } = buildTicketFilters(req);
  const summary = await pool.query(`
    SELECT COUNT(*)::int total,
           COUNT(*) FILTER(WHERE LOWER(estado) IN ('resuelto','cerrado'))::int resueltos,
           COUNT(*) FILTER(WHERE LOWER(estado) IN ('en progreso','en_progreso'))::int en_progreso,
           COUNT(*) FILTER(WHERE LOWER(estado) IN ('en espera','planificado'))::int pausados,
           COALESCE(AVG(duracion_neta_segundos),0)::bigint promedio_neto_segundos,
           COUNT(*) FILTER(WHERE duracion_neta_segundos IS NOT NULL AND sla_objetivo_minutos IS NOT NULL AND duracion_neta_segundos <= sla_objetivo_minutos*60)::int dentro_sla,
           COUNT(*) FILTER(WHERE duracion_neta_segundos IS NOT NULL AND sla_objetivo_minutos IS NOT NULL AND duracion_neta_segundos > sla_objetivo_minutos*60)::int fuera_sla
    FROM tickets
    ${whereSql}`, params);
  const categories = await pool.query(`SELECT categoria,COUNT(*)::int total FROM tickets ${whereSql} GROUP BY categoria ORDER BY total DESC`, params);
  const priorities = await pool.query(`SELECT prioridad,COUNT(*)::int total FROM tickets ${whereSql} GROUP BY prioridad ORDER BY total DESC`, params);
  const statuses = await pool.query(`SELECT estado,COUNT(*)::int total FROM tickets ${whereSql} GROUP BY estado ORDER BY total DESC`, params);
  const heatmap = await pool.query(`SELECT EXTRACT(ISODOW FROM t_apertura)::int dia,EXTRACT(HOUR FROM t_apertura)::int hora,COUNT(*)::int total FROM tickets ${whereSql} GROUP BY 1,2 ORDER BY 1,2`, params);

  const technicianSql = req.user.role === 'tech'
    ? `WHERE u.role='tecnico' AND u.id=$1`
    : `WHERE u.role='tecnico'`;
  const utilization = await pool.query(`
    SELECT u.id tecnico_id,u.full_name nombre,
           COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(p.fin,NOW())-p.inicio))) FILTER(WHERE p.estado IN ('Activo','Ocupado')),0)::bigint segundos_productivos,
           COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(p.fin,NOW())-p.inicio))),0)::bigint segundos_registrados
    FROM app_users u
    LEFT JOIN historial_presencia p ON p.tecnico_id=u.id
    ${technicianSql}
    GROUP BY u.id
    ORDER BY u.full_name`, req.user.role === 'tech' ? [req.user.id] : []);

  return {
    filters: req.query,
    summary: summary.rows[0],
    categories: categories.rows,
    priorities: priorities.rows,
    statuses: statuses.rows,
    heatmap: heatmap.rows,
    utilization: utilization.rows,
  };
}

router.get('/', async (req, res) => res.json(await metrics(req)));

router.get('/performance.pdf', async (req, res) => {
  const data = await metrics(req);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="reporte-helpdesk.pdf"');
  const doc = new PDFDocument({ margin: 48, size: 'LETTER', info: { Title: 'Reporte operativo HelpDesk_X' } });
  doc.pipe(res);
  doc.rect(0, 0, 612, 112).fill('#0b1f3a');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text('HelpDesk_X', 48, 34);
  doc.font('Helvetica').fontSize(11).fillColor('#bfdbfe').text('Reporte operativo y cumplimiento de SLA', 48, 68);
  doc.fillColor('#64748b').fontSize(9).text(new Date().toLocaleString('es-GT'), 430, 48, { width: 134, align: 'right' });
  const cards = [
    ['Tickets', data.summary.total, '#2563eb'],
    ['Resueltos', data.summary.resueltos, '#16a34a'],
    ['Dentro de SLA', data.summary.dentro_sla, '#7c3aed'],
    ['Promedio neto', `${Math.round(Number(data.summary.promedio_neto_segundos || 0) / 60)} min`, '#ea580c'],
  ];
  cards.forEach(([label, value, color], index) => {
    const x = 48 + index * 130;
    doc.roundedRect(x, 138, 116, 76, 8).fill('#f8fafc').stroke('#dbe5f0');
    doc.fillColor(color).font('Helvetica-Bold').fontSize(22).text(String(value), x + 12, 157, { width: 92 });
    doc.fillColor('#475569').font('Helvetica').fontSize(9).text(label, x + 12, 188, { width: 92 });
  });
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(16).text('Volumen por categoría', 48, 250);
  const max = Math.max(1, ...data.categories.map((item) => Number(item.total)));
  data.categories.forEach((item, index) => {
    const y = 290 + index * 48;
    doc.fillColor('#334155').font('Helvetica').fontSize(10).text(item.categoria || 'Sin categoría', 48, y, { width: 110 });
    doc.roundedRect(160, y, 340, 16, 4).fill('#e2e8f0');
    doc.roundedRect(160, y, Math.max(12, 340 * Number(item.total) / max), 16, 4).fill('#2563eb');
    doc.fillColor('#0f172a').font('Helvetica-Bold').text(String(item.total), 512, y + 2, { width: 40, align: 'right' });
  });
  doc.addPage();
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(18).text('Utilización de jornada', 48, 48);
  data.utilization.forEach((item, index) => {
    const productive = Number(item.segundos_productivos || 0);
    const registered = Number(item.segundos_registrados || 0);
    const percent = registered ? Math.round(productive * 100 / registered) : 0;
    const y = 92 + index * 54;
    doc.fillColor('#334155').font('Helvetica').fontSize(10).text(item.nombre, 48, y, { width: 170 });
    doc.roundedRect(230, y, 250, 16, 4).fill('#e2e8f0');
    doc.roundedRect(230, y, Math.max(4, 250 * Math.min(percent, 100) / 100), 16, 4).fill('#16a34a');
    doc.fillColor('#0f172a').font('Helvetica-Bold').text(`${percent}%`, 494, y + 2, { width: 55, align: 'right' });
  });
  doc.moveTo(48, 700).lineTo(564, 700).strokeColor('#dbe5f0').stroke();
  doc.fillColor('#64748b').font('Helvetica').fontSize(8).text('Generado por HelpDesk_X · Datos provenientes de PostgreSQL', 48, 714, { width: 516, align: 'center' });
  doc.end();
});

module.exports = router;
