import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ADMIN_API_URL } from '../../config/api';

function getScore(item) {
  return Number(item.score || item.stars || item.puntuacion || item.rating || 0);
}

function getComment(item) {
  return item.comment || item.comentario || item.feedback || item.comentario_evidencia || '';
}

function RatingsPage({ authToken }) {
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [filterStars, setFilterStars] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const token = authToken || localStorage.getItem('helpdesk_x_token') || '';
    setLoading(true);

    axios.get(`${ADMIN_API_URL}/ratings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => {
        if (Array.isArray(response.data)) setRatings(response.data);
        else if (Array.isArray(response.data?.ratings)) setRatings(response.data.ratings);
        else setRatings([]);
      })
      .catch(() => setRatings([]))
      .finally(() => setLoading(false));
  }, [authToken]);

  const filteredRatings = useMemo(() => {
    const search = query.trim().toLowerCase();

    return ratings.filter((item) => {
      const type = item.rating_type || item.type || item.tipo || '';
      const score = getScore(item);

      if (filterType !== 'all' && type !== filterType) return false;
      if (filterStars === 'low' && !(score > 0 && score <= 3)) return false;
      if (filterStars === '5' && score !== 5) return false;
      if (filterStars === '4' && score !== 4) return false;

      if (search) {
        const text = [
          item.ticket_id,
          item.ticket_number,
          item.category,
          item.categoria,
          item.priority,
          item.prioridad,
          item.associate_name,
          item.asociado_nombre,
          item.technician_name,
          item.tecnico_nombre,
          getComment(item),
        ].join(' ').toLowerCase();

        if (!text.includes(search)) return false;
      }

      return true;
    });
  }, [ratings, filterType, filterStars, query]);

  return (
    <section className="module-page ratings-page">
      <div className="module-header">
        <div>
          <h1>Matriz de Calificaciones</h1>
          <p>Auditoría cruzada de servicio: Asociado ↔ Técnico.</p>
        </div>
      </div>

      <div className="panel ratings-filters">
        <label>
          Tipo
          <select value={filterType} onChange={(event) => setFilterType(event.target.value)}>
            <option value="all">Todas</option>
            <option value="associate_to_technician">Asociado → Técnico</option>
            <option value="technician_to_associate">Técnico → Asociado</option>
          </select>
        </label>

        <label>
          Estrellas
          <select value={filterStars} onChange={(event) => setFilterStars(event.target.value)}>
            <option value="all">Cualquier puntuación</option>
            <option value="low">Bajas (≤ 3★)</option>
            <option value="5">Excelente (5★)</option>
            <option value="4">Buena (4★)</option>
          </select>
        </label>

        <label>
          Buscar
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticket, técnico, asociado, comentario..." />
        </label>
      </div>

      <div className="panel cross-ratings-panel">
        {loading ? (
          <div className="empty-state-card">Cargando calificaciones...</div>
        ) : (
          <>
            <div className="module-row head ratings-row">
              <span>Ticket</span>
              <span>Tipo</span>
              <span>Personas</span>
              <span>Estrellas</span>
              <span>Comentario</span>
            </div>

            {filteredRatings.map((rating) => {
              const type = rating.rating_type || rating.type || rating.tipo;
              const score = getScore(rating);
              const isAssociateToTechnician = type === 'associate_to_technician';

              return (
                <div className="module-row ratings-row" key={rating.id || `${rating.ticket_id}-${type}`}>
                  <strong>#{rating.ticket_number || rating.ticket_id || 'N/A'}</strong>
                  <span>{isAssociateToTechnician ? 'Asociado → Técnico' : 'Técnico → Asociado'}</span>
                  <span>
                    <b>{rating.associate_name || rating.asociado_nombre || rating.rater_name || 'Asociado'}</b>
                    <small> / {rating.technician_name || rating.tecnico_nombre || rating.rated_name || 'Técnico'}</small>
                  </span>
                  <span className="stars-readonly">{'★'.repeat(score)}{'☆'.repeat(Math.max(0, 5 - score))}</span>
                  <p>{getComment(rating) || 'Sin comentario registrado.'}</p>
                </div>
              );
            })}

            {!filteredRatings.length && (
              <div className="empty-state-card">No hay calificaciones con los filtros actuales.</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default RatingsPage;
