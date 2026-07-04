import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import PageHeader from './PageHeader';
import { ADMIN_API_URL as API } from '../../config/api';

function normalizePresence(value) {
  return String(value || 'offline')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');
}

function getHeaders(authToken) {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };
}

function getTechName(tech) {
  return tech?.full_name || tech?.name || tech?.username || 'Técnico';
}

function getTechUsername(tech) {
  return tech?.username || String(getTechName(tech)).toLowerCase().replace(/\s+/g, '.');
}

function TechniciansAssignmentPage({ authToken, tickets = [], onUpdated }) {
  const headers = useMemo(() => getHeaders(authToken), [authToken]);

  const [data, setData] = useState({
    technicians: [],
    categories: [],
    rules: [],
    ticketLoad: [],
    presence: [],
    waitingQueue: { total: 0 },
  });

  const [directory, setDirectory] = useState({
    users: [],
    presence: [],
    ratings: [],
  });

  const [selectedCategory, setSelectedCategory] = useState('');
  const [matrixDraft, setMatrixDraft] = useState({});
  const [preview, setPreview] = useState(null);
  const [savingMatrix, setSavingMatrix] = useState(false);
  const [loading, setLoading] = useState(true);

  const [ticketId, setTicketId] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [reason, setReason] = useState('');
  const [savingReassign, setSavingReassign] = useState(false);

  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    if (!authToken) return;

    setLoading(true);
    setError('');

    try {
      const [dashboard, dir] = await Promise.all([
        axios.get(`${API}/assignment-dashboard`, { headers }),
        axios.get(`${API}/directory`, { headers }),
      ]);

      const dashboardData = dashboard.data || {};
      const directoryData = dir.data || {};

      setData({
        technicians: dashboardData.technicians || [],
        categories: dashboardData.categories || [],
        rules: dashboardData.rules || [],
        ticketLoad: dashboardData.ticketLoad || [],
        presence: dashboardData.presence || [],
        waitingQueue: dashboardData.waitingQueue || { total: 0 },
      });

      setDirectory({
        users: directoryData.users || [],
        presence: directoryData.presence || [],
        ratings: directoryData.ratings || [],
      });

      const firstCategory = dashboardData.categories?.[0]?.id;

      setSelectedCategory((current) => current || (firstCategory ? String(firstCategory) : ''));
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo cargar la consola de técnicos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const techs = data.technicians || [];
  const categories = data.categories || [];

  const selectedCategoryData = categories.find((category) => String(category.id) === String(selectedCategory));
  const selectedRules = (data.rules || []).filter((rule) => String(rule.categoria_id) === String(selectedCategory));

  useEffect(() => {
    if (!selectedCategory) return;

    const draft = {};

    techs.forEach((tech) => {
      const rule = selectedRules.find((item) => Number(item.tecnico_id) === Number(tech.id));

      draft[tech.id] = {
        enabled: Boolean(rule && !rule.excluido),
        priority: Number(rule?.prioridad_skill || 3),
        responsibility: rule?.descripcion_responsabilidad || '',
      };
    });

    setMatrixDraft(draft);
    setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, data.rules, data.technicians]);

  const filteredTechs = useMemo(() => {
    const needle = search.trim().toLowerCase();

    if (!needle) return techs;

    return techs.filter((tech) => {
      return (
        getTechName(tech).toLowerCase().includes(needle) ||
        getTechUsername(tech).toLowerCase().includes(needle) ||
        String(tech.department || '').toLowerCase().includes(needle)
      );
    });
  }, [techs, search]);

  const presenceFor = (techId) => {
    return (data.presence || directory.presence || []).find((item) => Number(item.tecnico_id) === Number(techId));
  };

  const activeLoadFor = (techId) => {
    return (data.ticketLoad || [])
      .filter((item) => Number(item.tecnico_id) === Number(techId))
      .reduce((sum, item) => sum + Number(item.total || 0), 0);
  };

  const ratingFor = (techId) => {
    const directUser = (directory.users || []).find((item) => Number(item.id) === Number(techId));
    const directRating = Number(directUser?.rating || directUser?.promedio_rating || directUser?.average_rating);

    if (Number.isFinite(directRating) && directRating > 0) {
      return directRating.toFixed(2);
    }

    return directUser?.rating || '0.00';
  };

  const activeTechs = techs.filter((tech) => presenceFor(tech.id)?.estado === 'Activo').length;

  const configuredAreas = categories.filter((category) => !category.sin_responsable).length;

  const principal = selectedCategoryData?.responsable_principal;

  const assignedTechsForSelectedCategory = techs.filter((tech) => matrixDraft[tech.id]?.enabled);

  const waitingCount = Number(data.waitingQueue?.total || 0);

  const updateDraft = (techId, patch) => {
    setMatrixDraft((current) => ({
      ...current,
      [techId]: {
        enabled: false,
        priority: 3,
        responsibility: '',
        ...(current[techId] || {}),
        ...patch,
      },
    }));
  };

  const updatePriority = (techId, value) => {
    const priority = Number(value);

    let responsibility = matrixDraft[techId]?.responsibility || '';

    if (!responsibility) {
      if (priority === 1) responsibility = `Responsable principal de ${selectedCategoryData?.nombre_categoria || 'área'}`;
      if (priority === 2) responsibility = `Soporte secundario de ${selectedCategoryData?.nombre_categoria || 'área'}`;
      if (priority >= 3) responsibility = `Respaldo operativo de ${selectedCategoryData?.nombre_categoria || 'área'}`;
    }

    updateDraft(techId, {
      enabled: true,
      priority,
      responsibility,
    });
  };

  const saveMatrix = async () => {
    if (!selectedCategory) return;

    setSavingMatrix(true);
    setStatus('');
    setError('');

    try {
      const assignments = techs.map((tech) => ({
        technicianId: tech.id,
        excluded: !matrixDraft[tech.id]?.enabled,
        priority: Number(matrixDraft[tech.id]?.priority || 3),
        responsibility: matrixDraft[tech.id]?.responsibility || '',
      }));

      await axios.put(
        `${API}/assignment-matrix/${selectedCategory}`,
        { assignments },
        { headers }
      );

      await load();
      setStatus('Matriz de asignación guardada. La bolsa de espera se reprocesó automáticamente.');
      onUpdated?.();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo guardar la matriz.');
    } finally {
      setSavingMatrix(false);
    }
  };

  const loadPreview = async () => {
    if (!selectedCategory) return;

    setError('');

    try {
      const response = await axios.get(`${API}/assignment-preview`, {
        headers,
        params: { categoryId: selectedCategory },
      });

      setPreview(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo previsualizar la asignación.');
    }
  };

  const reassign = async () => {
    if (!ticketId || !technicianId || !reason.trim()) {
      setError('Seleccione ticket, técnico destino y motivo de reasignación.');
      return;
    }

    setSavingReassign(true);
    setStatus('');
    setError('');

    try {
      await axios.post(
        `${API}/tickets/${ticketId}/assign`,
        {
          technicianId,
          reason: reason.trim(),
        },
        { headers }
      );

      setTicketId('');
      setTechnicianId('');
      setReason('');
      setStatus('Ticket reasignado correctamente.');
      onUpdated?.();
      load().catch(() => {});
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo reasignar el ticket.');
    } finally {
      setSavingReassign(false);
    }
  };

  return (
    <section className="module-page technicians-assignment-page">
      <PageHeader
        title="Técnicos"
        subtitle="Responsables por área, prioridad de asignación y disponibilidad operativa."
      />

      {status && <div className="tech-admin-success">✓ {status}</div>}
      {error && <div className="tech-admin-error">⚠ {error}</div>}

      <div className="tech-admin-summary">
        <article>
          <span>Técnicos registrados</span>
          <strong>{techs.length}</strong>
          <small>Usuarios con rol soporte</small>
        </article>

        <article>
          <span>Activos ahora</span>
          <strong>{activeTechs}</strong>
          <small>Disponibles por presencia</small>
        </article>

        <article>
          <span>Áreas configuradas</span>
          <strong>{configuredAreas}/{categories.length || 0}</strong>
          <small>Con responsable principal</small>
        </article>

        <article>
          <span>Bolsa de espera</span>
          <strong className={waitingCount > 0 ? 'danger' : ''}>{waitingCount}</strong>
          <small>Tickets pendientes</small>
        </article>
      </div>

      <div className="tech-admin-layout">
        <aside className="panel tech-admin-directory">
          <div className="tech-admin-section-head">
            <div>
              <h3>Equipo técnico</h3>
              <p>{loading ? 'Cargando técnicos...' : `${filteredTechs.length} técnicos visibles`}</p>
            </div>

            <button className="tech-admin-ghost" onClick={load} disabled={loading}>
              Refrescar
            </button>
          </div>

          <input
            className="tech-admin-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar técnico, usuario o departamento..."
          />

          <div className="tech-admin-person-list">
            {filteredTechs.map((tech) => {
              const presence = presenceFor(tech.id);
              const statusClass = normalizePresence(presence?.estado);
              const isAssigned = Boolean(matrixDraft[tech.id]?.enabled);

              return (
                <article className={`tech-admin-person ${isAssigned ? 'selected' : ''}`} key={tech.id}>
                  <div className="tech-admin-avatar">{tech.avatar || '👨‍💻'}</div>

                  <div className="tech-admin-person-body">
                    <div className="tech-admin-person-title">
                      <h3>{getTechName(tech)}</h3>
                      <span className={`tech-admin-presence ${statusClass}`}>
                        {presence?.estado || 'Offline'}
                      </span>
                    </div>

                    <p>{getTechUsername(tech)} · {tech.department || 'TI'}</p>

                    <div className="tech-admin-person-meta">
                      <span>⭐ {ratingFor(tech.id)}</span>
                      <span>{activeLoadFor(tech.id)} tickets activos</span>
                      {isAssigned && <span>{selectedCategoryData?.nombre_categoria}</span>}
                    </div>
                  </div>
                </article>
              );
            })}

            {!loading && !filteredTechs.length && (
              <div className="empty-state-card">
                <strong>No hay técnicos para mostrar.</strong>
                <p>Verifica usuarios técnicos o cambia el filtro de búsqueda.</p>
              </div>
            )}
          </div>
        </aside>

        <main className="panel tech-admin-matrix">
          <div className="tech-admin-section-head">
            <div>
              <h3>Matriz de responsables</h3>
              <p>Define qué técnicos atienden cada categoría y el orden de asignación.</p>
            </div>

            <select
              className="tech-admin-area-select"
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.nombre_categoria}
                </option>
              ))}
            </select>
          </div>

          <div className="tech-admin-leader">
            <div>
              <span>Responsable principal</span>
              <strong>{principal?.tecnico || 'Sin responsable configurado'}</strong>
              <small>
                {principal
                  ? `Prioridad ${principal.prioridad_skill} · ${principal.descripcion_responsabilidad || 'Sin descripción'}`
                  : 'Los tickets irán a bolsa de espera si no hay reglas elegibles.'}
              </small>
            </div>

            <div className="tech-admin-leader-count">
              <strong>{assignedTechsForSelectedCategory.length}</strong>
              <span>asignados</span>
            </div>
          </div>

          <div className="tech-admin-matrix-list">
            {techs.map((tech) => {
              const draft = matrixDraft[tech.id] || {};
              const presence = presenceFor(tech.id);
              const statusClass = normalizePresence(presence?.estado);

              return (
                <article className={`tech-admin-matrix-row ${draft.enabled ? 'enabled' : ''}`} key={tech.id}>
                  <label className="tech-admin-switch">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.enabled)}
                      onChange={(event) => updateDraft(tech.id, { enabled: event.target.checked })}
                    />
                    <span />
                  </label>

                  <div className="tech-admin-matrix-user">
                    <strong>{getTechName(tech)}</strong>
                    <small>{getTechUsername(tech)}</small>
                  </div>

                  <label className="tech-admin-field">
                    <span>Prioridad</span>
                    <select
                      value={draft.priority || 3}
                      disabled={!draft.enabled}
                      onChange={(event) => updatePriority(tech.id, event.target.value)}
                    >
                      <option value={1}>1 · Principal</option>
                      <option value={2}>2 · Secundario</option>
                      <option value={3}>3 · Respaldo</option>
                      <option value={4}>4 · Baja prioridad</option>
                    </select>
                  </label>

                  <label className="tech-admin-field responsibility">
                    <span>Responsabilidad</span>
                    <input
                      value={draft.responsibility || ''}
                      disabled={!draft.enabled}
                      onChange={(event) => updateDraft(tech.id, { responsibility: event.target.value })}
                      placeholder={`Ej. Responsable principal de ${selectedCategoryData?.nombre_categoria || 'esta área'}`}
                    />
                  </label>

                  <div className="tech-admin-status-wrap">
                    <span className={`tech-admin-presence ${statusClass}`}>
                      {presence?.estado || 'Offline'}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          {preview && (
            <div className="tech-admin-preview">
              <div className="tech-admin-preview-head">
                <h4>Resultado simulado</h4>
                <button type="button" onClick={() => setPreview(null)}>Ocultar</button>
              </div>

              <p>
                {preview.wouldAssignTo ? (
                  <>
                    Caería a <strong>{preview.wouldAssignTo.full_name}</strong> por prioridad{' '}
                    <strong>{preview.wouldAssignTo.prioridad_skill}</strong>.
                  </>
                ) : (
                  'No hay técnico elegible activo para esta categoría.'
                )}
              </p>

              <div className="tech-admin-preview-list">
                {(preview.candidates || []).map((candidate) => (
                  <span key={candidate.id} className={candidate.elegible ? 'ok' : 'blocked'}>
                    <strong>{candidate.full_name}</strong>
                    {candidate.elegible
                      ? 'Elegible'
                      : candidate.razones_exclusion?.join(', ') || 'No elegible'}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="tech-admin-actions">
            <button className="tech-admin-primary" onClick={saveMatrix} disabled={!selectedCategory || savingMatrix}>
              {savingMatrix ? 'Guardando...' : 'Guardar matriz'}
            </button>

            <button className="tech-admin-secondary" onClick={loadPreview} disabled={!selectedCategory}>
              Previsualizar asignación
            </button>
          </div>
        </main>
      </div>

      <section className="panel tech-admin-reassign">
        <div className="tech-admin-section-head">
          <div>
            <h3>Reasignación forzada</h3>
            <p>Mueve un ticket manualmente por carga, prioridad o disponibilidad del técnico.</p>
          </div>
        </div>

        <div className="tech-admin-reassign-grid">
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
                <option key={tech.id} value={tech.id}>
                  {getTechName(tech)}
                </option>
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
            className="tech-admin-primary"
            disabled={!ticketId || !technicianId || !reason.trim() || savingReassign}
            onClick={reassign}
          >
            {savingReassign ? 'Reasignando...' : 'Forzar reasignación'}
          </button>
        </div>
      </section>
    </section>
  );
}

export default TechniciansAssignmentPage;