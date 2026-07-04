import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import PageHeader from './PageHeader';
import { ADMIN_API_URL as ADMIN_API } from '../../config/api';

const DEFAULT_AREAS = ['Software', 'Hardware', 'Redes', 'Accesos'];

function normalizeState(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');
}

function getTicketState(value) {
  return String(value || '').toLowerCase();
}

function getAuthHeaders(authToken) {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };
}

function getRole(user) {
  return String(user?.role || '').toLowerCase();
}

function isTechUser(user) {
  const role = getRole(user);
  return role === 'tech' || role === 'tecnico';
}

function getUserName(user) {
  return user?.full_name || user?.name || user?.username || 'Técnico';
}

function getUsername(user) {
  return user?.username || String(getUserName(user)).toLowerCase().replace(/\s+/g, '.');
}

function TechniciansPage({ authToken, tickets = [], onUpdated }) {
  const [data, setData] = useState({ users: [], presence: [], ratings: [], matrix: {} });
  const [categories, setCategories] = useState([]);
  const [ticketId, setTicketId] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [reason, setReason] = useState('');
  const [selectedArea, setSelectedArea] = useState('Software');
  const [showPreview, setShowPreview] = useState(false);
  const [matrixConfig, setMatrixConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingMatrix, setSavingMatrix] = useState(false);
  const [savingReassign, setSavingReassign] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const loadDirectory = async () => {
    if (!authToken) return;

    setLoading(true);
    setError('');

    try {
      const response = await axios.get(`${ADMIN_API}/directory`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      setData(response.data || { users: [], presence: [], ratings: [], matrix: {} });
      setMatrixConfig(response.data?.matrix || {});
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo cargar el directorio de técnicos.');
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    if (!authToken) return;

    try {
      const response = await axios.get(`${ADMIN_API}/categories`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const rows = Array.isArray(response.data) ? response.data : response.data?.categories || [];
      setCategories(rows);
      if (rows.length && !rows.some((cat) => cat.nombre_categoria === selectedArea)) {
        setSelectedArea(rows[0].nombre_categoria);
      }
    } catch {
      setCategories([]);
    }
  };

  useEffect(() => {
    loadDirectory();
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const showSuccess = (text) => {
    setMessage(text);
    setError('');
    setTimeout(() => setMessage(''), 3200);
  };

  const techs = useMemo(() => {
    return (data.users || [])
      .filter(isTechUser)
      .filter((tech) => {
        const needle = search.trim().toLowerCase();
        if (!needle) return true;

        return (
          getUserName(tech).toLowerCase().includes(needle) ||
          getUsername(tech).toLowerCase().includes(needle) ||
          String(tech.department || '').toLowerCase().includes(needle)
        );
      });
  }, [data.users, search]);

  const areasCatalog = useMemo(() => {
    const dynamicAreas = categories
      .map((cat) => cat.nombre_categoria || cat.categoria)
      .filter(Boolean);

    return dynamicAreas.length ? dynamicAreas : DEFAULT_AREAS;
  }, [categories]);

  const selectedAreaConfig = matrixConfig[selectedArea] || {};

  const presenceByTechId = useMemo(() => {
    return (data.presence || []).reduce((acc, item) => {
      acc[String(item.tecnico_id)] = item;
      return acc;
    }, {});
  }, [data.presence]);

  const ratingsByTechId = useMemo(() => {
    return (data.ratings || []).reduce((acc, rating) => {
      const key = String(rating.tecnico_id || rating.rated_user_id || rating.user_id || '');
      if (!acc[key]) acc[key] = [];
      acc[key].push(rating);
      return acc;
    }, {});
  }, [data.ratings]);

  const activeTicketsByTechId = useMemo(() => {
    return tickets.reduce((acc, ticket) => {
      const techId = String(ticket.tecnico_id || ticket.technician_id || '');
      if (!techId) return acc;

      const state = getTicketState(ticket.estado);
      const isClosed =
        state.includes('cerrado') ||
        state.includes('resuelto') ||
        state.includes('closed') ||
        state.includes('resolved');

      if (!isClosed) {
        acc[techId] = (acc[techId] || 0) + 1;
      }

      return acc;
    }, {});
  }, [tickets]);

  const waitingTickets = tickets.filter((ticket) => {
    const state = getTicketState(ticket.estado);
    return state.includes('nuevo') || state.includes('bolsa') || state.includes('espera');
  });

  const configuredAreasCount = areasCatalog.filter((area) => {
    const config = matrixConfig[area] || {};
    return Object.values(config).some((tech) => tech.usar);
  }).length;

  const activeTechs = techs.filter((tech) => {
    const state = presenceByTechId[String(tech.id)];
    return normalizeState(state?.estado || '') === 'activo';
  }).length;

  const getTechRating = (tech) => {
    const direct = Number(tech.rating || tech.promedio_rating || tech.average_rating);
    if (Number.isFinite(direct) && direct > 0) return direct.toFixed(2);

    const rows = ratingsByTechId[String(tech.id)] || [];
    if (!rows.length) return '—';

    const values = rows
      .map((row) => Number(row.score || row.stars || row.puntuacion))
      .filter((value) => Number.isFinite(value));

    if (!values.length) return '—';

    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    return avg.toFixed(2);
  };

  const getAreaLeader = () => {
    const leaderId = Object.keys(selectedAreaConfig).find((id) => {
      const config = selectedAreaConfig[id];
      return config?.usar && Number(config?.prioridad) === 1;
    });

    if (!leaderId) return null;

    return techs.find((tech) => String(tech.id) === String(leaderId)) || null;
  };

  const areaLeader = getAreaLeader();

  const handleCheckboxChange = (techId) => {
    setMatrixConfig((prev) => {
      const areaConfig = prev[selectedArea] || {};
      const techConfig = areaConfig[techId] || {
        usar: false,
        prioridad: 2,
        responsabilidad: `Soporte secundario de ${selectedArea}`,
      };

      return {
        ...prev,
        [selectedArea]: {
          ...areaConfig,
          [techId]: {
            ...techConfig,
            usar: !techConfig.usar,
            responsabilidad: techConfig.responsabilidad || `Soporte secundario de ${selectedArea}`,
          },
        },
      };
    });
  };

  const handlePriorityChange = (techId, priorityValue) => {
    const prioridad = Number(priorityValue);

    let responsabilidad = `Soporte secundario de ${selectedArea}`;
    if (prioridad === 1) responsabilidad = `Responsable principal de ${selectedArea}`;
    if (prioridad === 3) responsabilidad = `Respaldo de emergencia de ${selectedArea}`;

    setMatrixConfig((prev) => ({
      ...prev,
      [selectedArea]: {
        ...(prev[selectedArea] || {}),
        [techId]: {
          ...(prev[selectedArea]?.[techId] || {}),
          usar: true,
          prioridad,
          responsabilidad,
        },
      },
    }));
  };

  const handleResponsibilityChange = (techId, value) => {
    setMatrixConfig((prev) => ({
      ...prev,
      [selectedArea]: {
        ...(prev[selectedArea] || {}),
        [techId]: {
          ...(prev[selectedArea]?.[techId] || {}),
          responsabilidad: value,
        },
      },
    }));
  };

  const saveMatrix = async () => {
    setSavingMatrix(true);
    setError('');
    setMessage('');

    try {
      await axios.post(
        `${ADMIN_API}/matrix`,
        { matrix: matrixConfig },
        { headers: getAuthHeaders(authToken) }
      );

      showSuccess(`Matriz de responsables para ${selectedArea} guardada correctamente.`);
      onUpdated?.();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo guardar la matriz de responsables.');
    } finally {
      setSavingMatrix(false);
    }
  };

  const reassign = async () => {
    if (!ticketId || !technicianId || !reason.trim()) {
      setError('Seleccione ticket, técnico y escriba el motivo de reasignación.');
      return;
    }

    setSavingReassign(true);
    setError('');
    setMessage('');

    try {
      await axios.post(
        `${ADMIN_API}/tickets/${ticketId}/assign`,
        { technicianId, tecnico_id: technicianId, technician_id: technicianId, reason: reason.trim(), motivo: reason.trim() },
        { headers: getAuthHeaders(authToken) }
      );

      setTicketId('');
      setTechnicianId('');
      setReason('');
      showSuccess('Ticket reasignado correctamente.');
      onUpdated?.();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo reasignar el ticket.');
    } finally {
      setSavingReassign(false);
    }
  };

  const selectedAreaAssignedTechs = techs.filter((tech) => selectedAreaConfig[tech.id]?.usar);

  return (
    <section className="module-page technicians-admin-page">
      <PageHeader
        title="Técnicos"
        subtitle="Responsables por área, prioridad de asignación y disponibilidad operativa."
      />

      {message && <div className="admin-inline-success">✓ {message}</div>}
      {error && <div className="admin-inline-error">⚠ {error}</div>}

      <div className="tech-summary-grid">
        <article className="tech-summary-card">
          <span>Técnicos registrados</span>
          <strong>{techs.length}</strong>
          <small>Usuarios con rol soporte</small>
        </article>

        <article className="tech-summary-card">
          <span>Activos ahora</span>
          <strong>{activeTechs}</strong>
          <small>Disponibles por presencia</small>
        </article>

        <article className="tech-summary-card">
          <span>Áreas configuradas</span>
          <strong>{configuredAreasCount}/{areasCatalog.length}</strong>
          <small>Matriz con responsables</small>
        </article>

        <article className="tech-summary-card">
          <span>Bolsa de espera</span>
          <strong className={waitingTickets.length ? 'danger-number' : ''}>{waitingTickets.length}</strong>
          <small>Tickets pendientes de asignación</small>
        </article>
      </div>

      <div className="tech-board-layout">
        <div className="panel tech-directory-panel">
          <div className="tech-section-head">
            <div>
              <h3>Equipo técnico</h3>
              <p>{loading ? 'Cargando técnicos...' : `${techs.length} técnicos encontrados`}</p>
            </div>

            <button className="tech-ghost-btn" onClick={loadDirectory} disabled={loading}>
              Refrescar
            </button>
          </div>

          <input
            className="tech-search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar técnico, usuario o departamento..."
          />

          <div className="tech-card-list">
            {techs.map((tech) => {
              const state = presenceByTechId[String(tech.id)];
              const status = state?.estado || 'Fuera de Servicio';
              const statusClass = normalizeState(status);
              const activeCount = activeTicketsByTechId[String(tech.id)] || 0;
              const configuredInSelectedArea = Boolean(selectedAreaConfig[tech.id]?.usar);

              return (
                <article className={`tech-person-card ${configuredInSelectedArea ? 'configured' : ''}`} key={tech.id}>
                  <div className="tech-avatar">{tech.avatar || '👨‍💻'}</div>

                  <div className="tech-person-main">
                    <div className="tech-person-title">
                      <h3>{getUserName(tech)}</h3>
                      <span className={`presence-pill ${statusClass}`}>{status}</span>
                    </div>

                    <p>{getUsername(tech)} · {tech.department || 'TI'}</p>

                    <div className="tech-person-meta">
                      <span>⭐ {getTechRating(tech)}</span>
                      <span>{activeCount} tickets activos</span>
                      {configuredInSelectedArea && <span>Asignado a {selectedArea}</span>}
                    </div>
                  </div>
                </article>
              );
            })}

            {!loading && !techs.length && (
              <div className="empty-state-card">
                <strong>No hay técnicos registrados.</strong>
                <p>Crea usuarios técnicos desde el módulo de usuarios.</p>
              </div>
            )}
          </div>
        </div>

        <div className="panel tech-matrix-panel">
          <div className="tech-section-head">
            <div>
              <h3>Matriz de responsables</h3>
              <p>Define qué técnicos atienden cada área y en qué prioridad.</p>
            </div>

            <select
              className="tech-area-select"
              value={selectedArea}
              onChange={(event) => {
                setSelectedArea(event.target.value);
                setShowPreview(false);
              }}
            >
              {areasCatalog.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </div>

          <div className="tech-leader-card">
            <div>
              <span>Responsable principal</span>
              <strong>{areaLeader ? getUserName(areaLeader) : 'Sin responsable configurado'}</strong>
              <small>
                {areaLeader
                  ? `Prioridad 1 · ${selectedArea}`
                  : 'Si no configuras un responsable, el ticket irá a bolsa de espera.'}
              </small>
            </div>

            <div className="tech-leader-count">
              <strong>{selectedAreaAssignedTechs.length}</strong>
              <span>técnicos asignados</span>
            </div>
          </div>

          <div className="tech-matrix-list">
            {techs.map((tech) => {
              const state = presenceByTechId[String(tech.id)];
              const status = state?.estado || 'Fuera de Servicio';
              const statusClass = normalizeState(status);
              const config = selectedAreaConfig[tech.id] || {
                usar: false,
                prioridad: 2,
                responsabilidad: '',
              };

              return (
                <article className={`tech-matrix-row ${config.usar ? 'enabled' : ''}`} key={tech.id}>
                  <label className="tech-switch-line">
                    <input
                      type="checkbox"
                      checked={Boolean(config.usar)}
                      onChange={() => handleCheckboxChange(tech.id)}
                    />
                    <span />
                  </label>

                  <div className="tech-matrix-person">
                    <strong>{getUserName(tech)}</strong>
                    <small>{getUsername(tech)}</small>
                  </div>

                  <label className="tech-matrix-field priority-field">
                    <span>Prioridad</span>
                    <select
                      disabled={!config.usar}
                      value={config.prioridad || 2}
                      onChange={(event) => handlePriorityChange(tech.id, event.target.value)}
                    >
                      <option value={1}>1 · Principal</option>
                      <option value={2}>2 · Secundario</option>
                      <option value={3}>3 · Emergencia</option>
                    </select>
                  </label>

                  <label className="tech-matrix-field responsibility-field">
                    <span>Responsabilidad</span>
                    <input
                      disabled={!config.usar}
                      value={config.usar ? config.responsabilidad || '' : ''}
                      onChange={(event) => handleResponsibilityChange(tech.id, event.target.value)}
                      placeholder={`Ej. Responsable de ${selectedArea}`}
                    />
                  </label>

                  <div className="tech-matrix-status">
                    <span className={`presence-pill ${statusClass}`}>{status}</span>
                  </div>
                </article>
              );
            })}
          </div>

          {showPreview && (
            <div className="tech-preview-card">
              <h4>Previsualización de asignación · {selectedArea}</h4>

              {selectedAreaAssignedTechs.length ? (
                selectedAreaAssignedTechs
                  .sort((a, b) => Number(selectedAreaConfig[a.id]?.prioridad || 99) - Number(selectedAreaConfig[b.id]?.prioridad || 99))
                  .map((tech) => {
                    const config = selectedAreaConfig[tech.id];
                    const state = presenceByTechId[String(tech.id)];
                    const isOnline = normalizeState(state?.estado || '') === 'activo';

                    return (
                      <div className={`tech-preview-line ${isOnline ? 'online' : 'offline'}`} key={tech.id}>
                        <span>{isOnline ? '●' : '○'}</span>
                        <strong>{getUserName(tech)}</strong>
                        <em>{config?.responsabilidad || 'Sin responsabilidad definida'}</em>
                        <small>Prioridad {config?.prioridad || 2}</small>
                      </div>
                    );
                  })
              ) : (
                <p>No hay técnicos asignados a esta área.</p>
              )}
            </div>
          )}

          <div className="tech-actions-row">
            <button className="tech-primary-btn" onClick={saveMatrix} disabled={savingMatrix}>
              {savingMatrix ? 'Guardando...' : 'Guardar matriz'}
            </button>

            <button className="tech-secondary-btn" onClick={() => setShowPreview((current) => !current)}>
              {showPreview ? 'Ocultar previsualización' : 'Previsualizar asignación'}
            </button>
          </div>
        </div>
      </div>

      <div className="panel tech-reassign-panel">
        <div className="tech-section-head">
          <div>
            <h3>Reasignación forzada</h3>
            <p>Úsalo cuando el administrador necesite mover un ticket por carga, prioridad o disponibilidad.</p>
          </div>
        </div>

        <div className="tech-reassign-grid">
          <label>
            <span>Ticket</span>
            <select value={ticketId} onChange={(event) => setTicketId(event.target.value)}>
              <option value="">Selecciona ticket</option>
              {tickets.map((ticket) => (
                <option key={ticket.id} value={ticket.id}>
                  #{String(ticket.id).padStart(6, '0')} · {ticket.titulo_tecnico || ticket.titulo || ticket.categoria}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Técnico destino</span>
            <select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
              <option value="">Selecciona técnico</option>
              {techs.map((tech) => (
                <option key={tech.id} value={tech.id}>{getUserName(tech)}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Motivo</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej. Redistribución por carga activa"
            />
          </label>

          <button
            className="tech-primary-btn"
            disabled={!ticketId || !technicianId || !reason.trim() || savingReassign}
            onClick={reassign}
          >
            {savingReassign ? 'Reasignando...' : 'Forzar reasignación'}
          </button>
        </div>
      </div>
    </section>
  );
}

export default TechniciansPage;