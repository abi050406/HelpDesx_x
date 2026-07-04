const { client } = require('../redis');
const pool = require('../db');
const { emitAll } = require('./realtime.service');

const PRESENCE_KEY = 'helpdesk:tecnicos:presencia';
const ABSENCE_KEY = 'helpdesk:tecnicos:razones_ausencia';
const VALID_STATES = ['Activo', 'Ocupado', 'En Break', 'Fuera de Servicio'];

async function setTechnicianPresence(technicianId, state, reason = '') {
  if (!VALID_STATES.includes(state)) throw new Error('Estado de presencia inválido.');
  const id = String(technicianId);
  const cleanReason = String(reason || '').trim();
  if (state === 'Fuera de Servicio' && !cleanReason) throw new Error('La razón de ausencia es obligatoria para Fuera de Servicio.');
  const previousRaw = await client.hGet(PRESENCE_KEY, id);
  const previous = previousRaw ? JSON.parse(previousRaw) : null;
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    estado: state,
    ultima_actividad: now,
    disponible_desde: state === 'Activo' && previous?.estado !== 'Activo' ? now : previous?.disponible_desde || now,
  });
  await client.hSet(PRESENCE_KEY, id, payload);

  if (['En Break', 'Fuera de Servicio'].includes(state)) {
    await client.hSet(ABSENCE_KEY, id, JSON.stringify({ razon: cleanReason, estado: state, registrada_en: new Date().toISOString() }));
  } else {
    await client.hDel(ABSENCE_KEY, id);
  }

  await pool.query('UPDATE historial_presencia SET fin=NOW() WHERE tecnico_id=$1 AND fin IS NULL', [technicianId]);
  await pool.query('INSERT INTO historial_presencia(tecnico_id,estado,razon) VALUES($1,$2,$3)', [technicianId, state, cleanReason || null]);
  emitAll('presence:changed', { tecnico_id: Number(technicianId), estado: state });
  if (state === 'Activo') {
    const { processWaitingQueue } = require('./assignment.service');
    setImmediate(() => processWaitingQueue().catch((error) => console.error('Error procesando bolsa:', error.message)));
  }

  return { tecnico_id: Number(technicianId), estado: state };
}

async function touchTechnician(technicianId) {
  const raw = await client.hGet(PRESENCE_KEY, String(technicianId));
  if (!raw) return setTechnicianPresence(technicianId, 'Activo');
  const value = JSON.parse(raw);
  value.ultima_actividad = new Date().toISOString();
  await client.hSet(PRESENCE_KEY, String(technicianId), JSON.stringify(value));
  return value;
}

async function listTechnicianPresence() {
  const [presence, absences] = await Promise.all([client.hGetAll(PRESENCE_KEY), client.hGetAll(ABSENCE_KEY)]);
  return Object.entries(presence).map(([id, value]) => ({
    tecnico_id: Number(id),
    ...JSON.parse(value),
    ausencia: absences[id] ? JSON.parse(absences[id]) : null,
  }));
}

module.exports = { PRESENCE_KEY, ABSENCE_KEY, VALID_STATES, setTechnicianPresence, listTechnicianPresence, touchTechnician };
