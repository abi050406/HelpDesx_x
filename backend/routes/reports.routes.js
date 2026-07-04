const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../db');
const { requireAuth } = require('./auth.routes');

const router = express.Router();
router.use(requireAuth, (req, res, next) => ['admin','tech'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Acceso restringido.' }));

async function metrics() {
  const summary = await pool.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE LOWER(estado) IN ('resuelto','cerrado'))::int resueltos,COALESCE(AVG(duracion_neta_segundos),0)::bigint promedio_neto_segundos,COUNT(*) FILTER(WHERE duracion_neta_segundos <= sla_objetivo_minutos*60)::int dentro_sla FROM tickets`);
  const categories = await pool.query(`SELECT categoria,COUNT(*)::int total FROM tickets GROUP BY categoria ORDER BY total DESC`);
  const heatmap = await pool.query(`SELECT EXTRACT(ISODOW FROM t_apertura)::int dia,EXTRACT(HOUR FROM t_apertura)::int hora,COUNT(*)::int total FROM tickets GROUP BY 1,2 ORDER BY 1,2`);
  const utilization = await pool.query(`SELECT u.id tecnico_id,u.full_name nombre,COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(p.fin,NOW())-p.inicio))) FILTER(WHERE p.estado IN ('Activo','Ocupado')),0)::bigint segundos_productivos,COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(p.fin,NOW())-p.inicio))),0)::bigint segundos_registrados FROM app_users u LEFT JOIN historial_presencia p ON p.tecnico_id=u.id WHERE u.role='tecnico' GROUP BY u.id ORDER BY u.full_name`);
  return { summary: summary.rows[0], categories: categories.rows, heatmap: heatmap.rows, utilization: utilization.rows };
}

router.get('/', async (_req, res) => res.json(await metrics()));
router.get('/performance.pdf', async (_req, res) => {
  const data = await metrics();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="reporte-helpdesk.pdf"');
  const doc = new PDFDocument({ margin: 48, size: 'LETTER', info: { Title: 'Reporte operativo HelpDesk_X' } }); doc.pipe(res);
  doc.rect(0,0,612,112).fill('#0b1f3a');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text('HelpDesk_X',48,34);
  doc.font('Helvetica').fontSize(11).fillColor('#bfdbfe').text('Reporte operativo y cumplimiento de SLA',48,68);
  doc.fillColor('#64748b').fontSize(9).text(new Date().toLocaleString('es-GT'),430,48,{width:134,align:'right'});
  const cards=[['Tickets',data.summary.total,'#2563eb'],['Resueltos',data.summary.resueltos,'#16a34a'],['Dentro de SLA',data.summary.dentro_sla,'#7c3aed'],['Promedio neto',`${Math.round(Number(data.summary.promedio_neto_segundos||0)/60)} min`,'#ea580c']];
  cards.forEach(([label,value,color],index)=>{const x=48+index*130;doc.roundedRect(x,138,116,76,8).fill('#f8fafc').stroke('#dbe5f0');doc.fillColor(color).font('Helvetica-Bold').fontSize(22).text(String(value),x+12,157,{width:92});doc.fillColor('#475569').font('Helvetica').fontSize(9).text(label,x+12,188,{width:92});});
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(16).text('Volumen por categoría',48,250);
  const max=Math.max(1,...data.categories.map((item)=>Number(item.total)));
  data.categories.forEach((item,index)=>{const y=290+index*48;doc.fillColor('#334155').font('Helvetica').fontSize(10).text(item.categoria,48,y,{width:110});doc.roundedRect(160,y,340,16,4).fill('#e2e8f0');doc.roundedRect(160,y,Math.max(12,340*Number(item.total)/max),16,4).fill('#2563eb');doc.fillColor('#0f172a').font('Helvetica-Bold').text(String(item.total),512,y+2,{width:40,align:'right'});});
  doc.addPage();
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(18).text('Utilización de jornada',48,48);
  data.utilization.forEach((item,index)=>{const productive=Number(item.segundos_productivos||0);const registered=Number(item.segundos_registrados||0);const percent=registered?Math.round(productive*100/registered):0;const y=92+index*54;doc.fillColor('#334155').font('Helvetica').fontSize(10).text(item.nombre,48,y,{width:170});doc.roundedRect(230,y,250,16,4).fill('#e2e8f0');doc.roundedRect(230,y,Math.max(4,250*Math.min(percent,100)/100),16,4).fill('#16a34a');doc.fillColor('#0f172a').font('Helvetica-Bold').text(`${percent}%`,494,y+2,{width:55,align:'right'});});
  doc.moveTo(48,700).lineTo(564,700).strokeColor('#dbe5f0').stroke();
  doc.fillColor('#64748b').font('Helvetica').fontSize(8).text('Generado por HelpDesk_X · Datos provenientes de PostgreSQL',48,714,{width:516,align:'center'});
  doc.end();
});

module.exports = router;
