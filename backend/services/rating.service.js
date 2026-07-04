const pool = require('../db');

const RATING_TYPES = new Set(['associate_to_technician', 'technician_to_associate']);

function target(client) {
  return client || pool;
}

function validateStars(stars) {
  const value = Number(stars);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('La calificación debe ser un número entero entre 1 y 5.');
  }
  return value;
}

function validateComment(comment, minLength = 1) {
  const normalized = String(comment || '').trim().replace(/\s+/g, ' ');
  if (normalized.length < minLength) {
    throw new Error(minLength <= 1 ? 'El comentario es obligatorio.' : `El comentario debe tener al menos ${minLength} caracteres.`);
  }
  if (minLength > 1 && !/[a-záéíóúñ0-9]/i.test(normalized)) {
    throw new Error('El comentario debe contener texto válido.');
  }
  return normalized;
}

async function createTicketRating({
  ticketId,
  ratingType,
  raterUserId = null,
  raterName = null,
  ratedUserId = null,
  ratedName = null,
  stars,
  comment,
  minCommentLength = 1,
  client = null,
}) {
  const numericTicketId = Number(ticketId);
  if (!numericTicketId) throw new Error('ticketId inválido.');
  if (!RATING_TYPES.has(ratingType)) throw new Error('Tipo de calificación inválido.');
  const cleanStars = validateStars(stars);
  const cleanComment = validateComment(comment, minCommentLength);

  const result = await target(client).query(
    `INSERT INTO ticket_ratings(
       ticket_id,rating_type,rater_user_id,rater_name,rated_user_id,rated_name,stars,comment
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      numericTicketId,
      ratingType,
      raterUserId ? Number(raterUserId) : null,
      raterName || null,
      ratedUserId ? Number(ratedUserId) : null,
      ratedName || null,
      cleanStars,
      cleanComment,
    ]
  );
  return result.rows[0];
}

async function listTicketRatings(ticketId) {
  const numericTicketId = Number(ticketId);
  if (!numericTicketId) throw new Error('ticketId inválido.');
  const result = await pool.query(
    `SELECT r.*,t.id AS ticket_number,t.categoria AS category,t.prioridad AS priority,
            a.full_name AS associate_name, te.full_name AS technician_name
     FROM ticket_ratings r
     JOIN tickets t ON t.id=r.ticket_id
     LEFT JOIN app_users a ON a.id=t.usuario_id
     LEFT JOIN app_users te ON te.id=t.tecnico_id
     WHERE r.ticket_id=$1
     ORDER BY r.created_at DESC`,
    [numericTicketId]
  );
  return result.rows;
}

async function listRatings({ ratingType = null, ratedRole = null } = {}) {
  const params = [];
  const where = [];
  if (ratingType) {
    params.push(ratingType);
    where.push(`r.rating_type=$${params.length}`);
  }
  if (ratedRole) {
    params.push(ratedRole);
    where.push(`rated.role=$${params.length}`);
  }
  const result = await pool.query(
    `SELECT r.ticket_id,
            t.id AS ticket_number,
            t.categoria AS category,
            t.prioridad AS priority,
            a.full_name AS associate_name,
            te.full_name AS technician_name,
            r.rating_type,
            r.stars,
            r.comment,
            r.created_at,
            r.rater_user_id,
            r.rater_name,
            r.rated_user_id,
            r.rated_name
     FROM ticket_ratings r
     JOIN tickets t ON t.id=r.ticket_id
     LEFT JOIN app_users a ON a.id=t.usuario_id
     LEFT JOIN app_users te ON te.id=t.tecnico_id
     LEFT JOIN app_users rated ON rated.id=r.rated_user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC`,
    params
  );
  return result.rows;
}

module.exports = {
  createTicketRating,
  listTicketRatings,
  listRatings,
  validateStars,
  validateComment,
};
