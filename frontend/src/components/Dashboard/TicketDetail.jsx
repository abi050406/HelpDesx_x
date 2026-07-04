import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ADMIN_API_URL, priorityLabel, statusLabel } from '../../data/helpdeskData';
import { API_URL } from '../../config/api';

function getRatingScore(rating) {
  return Number(rating?.score || rating?.stars || rating?.puntuacion || rating?.rating || 0);
}

function getRatingComment(rating) {
  return rating?.comment || rating?.comentario || rating?.feedback || rating?.comentario_evidencia || '';
}

function normalizeRatings(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    return raw.reduce((acc, item) => {
      const type = item.rating_type || item.type || item.tipo;
      if (type === 'associate_to_technician') acc.associate_to_technician = item;
      if (type === 'technician_to_associate') acc.technician_to_associate = item;
      return acc;
    }, {});
  }
  return raw;
}




function getAssignmentMessage(ticket) {
  const code = ticket?.assignment_reason || ticket?.assignment_status;
  const message = ticket?.assignment_reason_message || ticket?.assignment_message || ticket?.motivo_asignacion_texto;

  if (message && String(message).trim()) return message;

  const messages = {
    NO_ASSIGNMENT_RULE: 'No existe regla de asignación para esta categoría.',
    NO_ACTIVE_PRESENCE: 'No hay técnicos con presencia activa.',
    TECHNICIANS_AT_CAPACITY: 'Todos los técnicos elegibles están al límite de capacidad.',
    TECHNICIANS_BUSY_HIGH_PRIORITY: 'Los técnicos elegibles están ocupados con tickets de alta prioridad.',
    SLA_RISK: 'La asignación automática detectó riesgo de SLA.',
    NO_ELIGIBLE_TECHNICIAN: 'No hay técnico elegible para este ticket.',
    waiting_pool: 'Ticket pendiente en bolsa de espera.',
  };

  return messages[code] || 'Asignación automática sin detalle registrado.';
}

function getAssignmentMeta(ticket) {
  const meta = ticket?.assignment_metadata || ticket?.metadata_asignacion || ticket?.assignment || {};
  return meta && typeof meta === 'object' ? meta : {};
}

function isUnassigned(ticket) {
  const techName = String(ticket?.tecnico || ticket?.tecnico_nombre || '').trim().toLowerCase();
  return !ticket?.tecnico_id && (!techName || techName === 'sin asignar' || techName === 'null');
}

function getTechName(tech) {
  return tech?.full_name || tech?.name || tech?.username || 'Técnico';
}


function formatDateTime(value) {
  if (!value) return '—';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);

  return new Intl.DateTimeFormat('es-NI', {
    timeZone: 'America/Managua',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function normalizeDiagnostic(ticket) {
  const diagnostic = ticket?.diagnostico || ticket?.ticket_diagnostico || ticket?.diagnostic || null;
  const answers = diagnostic?.respuestas_json || diagnostic?.answers || ticket?.respuestas_contexto || ticket?.respuestas || null;

  if (!diagnostic && !answers) return null;

  let rows = [];

  if (Array.isArray(answers)) {
    rows = answers.map((item, index) => ({
      question: item.question || item.pregunta || item.label || `Pregunta ${index + 1}`,
      answer: item.answer || item.respuesta || item.value || item.text || '—',
      score: item.score ?? item.puntaje,
    }));
  } else if (answers && typeof answers === 'object') {
    rows = Object.entries(answers).map(([question, answer]) => ({ question, answer, score: null }));
  }

  return {
    category: diagnostic?.categoria_nombre || ticket?.categoria,
    tag: diagnostic?.etiqueta_nombre || ticket?.etiqueta,
    priority: diagnostic?.prioridad_calculada || ticket?.prioridad,
    score: diagnostic?.puntaje_total || ticket?.puntaje_prioridad,
    sla: diagnostic?.sla_minutos || ticket?.sla_objetivo_minutos,
    rows,
  };
}

function TicketDetail({ selectedTicket, authToken }) {
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [remoteRatings, setRemoteRatings] = useState(null);
  const [activeTab, setActiveTab] = useState('messages');
  const [historyError, setHistoryError] = useState(false);
  const [adminDirectory, setAdminDirectory] = useState({ users: [] });
  const [assignmentView, setAssignmentView] = useState(null);
  const [assignmentError, setAssignmentError] = useState('');
  const [assignmentSuccess, setAssignmentSuccess] = useState('');
  const [manualTechId, setManualTechId] = useState('');
  const [manualReason, setManualReason] = useState('Asignación manual por administrador');
  const [assigning, setAssigning] = useState(false);
  const [localTicketPatch, setLocalTicketPatch] = useState(null);

  const activeToken = authToken || localStorage.getItem('helpdesk_x_token') || localStorage.getItem('token') || '';
  const requestConfig = { headers: { Authorization: `Bearer ${activeToken}` } };

  useEffect(() => {
    if (!selectedTicket?.id) return;

    axios.get(`${API_URL}/${selectedTicket.id}/messages`, requestConfig)
      .then((response) => {
        if (Array.isArray(response.data)) setMessages(response.data);
        else if (Array.isArray(response.data?.messages)) setMessages(response.data.messages);
        else if (response.data?.success && Array.isArray(response.data.data)) setMessages(response.data.data);
        else setMessages([]);
      })
      .catch(() => setMessages([]));
  }, [selectedTicket?.id, activeToken]);

  useEffect(() => {
    if (!selectedTicket?.id) return;

    setHistoryError(false);
    axios.get(`${API_URL}/${selectedTicket.id}/history`, requestConfig)
      .then((response) => {
        if (response.data?.success && Array.isArray(response.data.history)) {
          setHistory(response.data.history);
        } else if (Array.isArray(response.data)) {
          setHistory(response.data);
        } else {
          setHistory([]);
        }
      })
      .catch(() => {
        setHistory([]);
        setHistoryError(true);
      });
  }, [selectedTicket?.id, activeToken]);

  useEffect(() => {
    if (!selectedTicket?.id || !activeToken) return;

    setRemoteRatings(null);
    axios.get(`${ADMIN_API_URL}/tickets/${selectedTicket.id}/ratings`, requestConfig)
      .then((response) => {
        if (response.data?.success && response.data.ratings) setRemoteRatings(normalizeRatings(response.data.ratings));
        else if (response.data?.ratings) setRemoteRatings(normalizeRatings(response.data.ratings));
        else if (Array.isArray(response.data)) setRemoteRatings(normalizeRatings(response.data));
      })
      .catch(() => setRemoteRatings(null));
  }, [selectedTicket?.id, activeToken]);

  useEffect(() => {
    if (!activeToken) return;

    axios.get(`${ADMIN_API_URL}/directory`, requestConfig)
      .then((response) => setAdminDirectory({ users: response.data?.users || [] }))
      .catch(() => setAdminDirectory({ users: [] }));
  }, [activeToken]);

  useEffect(() => {
    setAssignmentView(null);
    setAssignmentError('');
    setAssignmentSuccess('');
    setManualTechId('');
    setManualReason('Asignación manual por administrador');
    setLocalTicketPatch(null);
  }, [selectedTicket?.id]);

  const adminTechnicians = useMemo(() => {
    return (adminDirectory.users || []).filter((user) => {
      const userRole = String(user.role || user.database_role || '').toLowerCase();
      return userRole === 'tech' || userRole === 'tecnico';
    });
  }, [adminDirectory.users]);

  const workingTicket = useMemo(() => ({
    ...(selectedTicket || {}),
    ...(localTicketPatch || {}),
  }), [selectedTicket, localTicketPatch]);

  const retryAssignment = async () => {
    if (!workingTicket?.id) return;

    setAssigning(true);
    setAssignmentError('');
    setAssignmentSuccess('');

    try {
      const response = await axios.post(`${ADMIN_API_URL}/tickets/${workingTicket.id}/reassign`, {}, {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Idempotency-Key': `retry-${workingTicket.id}-${Date.now()}`,
        },
      });

      const updated = response.data?.ticket || response.data?.data || response.data || {};
      setLocalTicketPatch(updated);
      setAssignmentSuccess(updated?.tecnico_id || updated?.tecnico_nombre
        ? `Ticket reasignado a ${updated.tecnico_nombre || updated.tecnico || 'técnico seleccionado'}.`
        : 'No se encontró técnico elegible todavía.');
    } catch (error) {
      setAssignmentError(error.response?.data?.error || error.response?.data?.message || 'No se pudo reintentar la asignación.');
    } finally {
      setAssigning(false);
    }
  };

  const simulateAssignment = async () => {
    if (!workingTicket?.id) return;

    setAssigning(true);
    setAssignmentError('');
    setAssignmentSuccess('');

    try {
      const response = await axios.post(`${ADMIN_API_URL}/tickets/${workingTicket.id}/simulate-assignment`, {}, {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Idempotency-Key': `simulate-${workingTicket.id}-${Date.now()}`,
        },
      });

      setAssignmentView(response.data);
    } catch (error) {
      setAssignmentError(error.response?.data?.error || error.response?.data?.message || 'No se pudo simular la asignación.');
    } finally {
      setAssigning(false);
    }
  };

  const manualAssign = async () => {
    if (!workingTicket?.id || !manualTechId || !manualReason.trim()) {
      setAssignmentError('Selecciona un técnico y escribe el motivo de asignación.');
      return;
    }

    setAssigning(true);
    setAssignmentError('');
    setAssignmentSuccess('');

    try {
      const response = await axios.post(`${ADMIN_API_URL}/tickets/${workingTicket.id}/assign`, {
        tecnico_id: manualTechId,
        technicianId: manualTechId,
        technician_id: manualTechId,
        reason: manualReason.trim(),
        motivo: manualReason.trim(),
      }, {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Idempotency-Key': `manual-assign-${workingTicket.id}-${Date.now()}`,
        },
      });

      const updated = response.data?.ticket || response.data?.data || response.data || {};
      setLocalTicketPatch(updated);
      setAssignmentSuccess(`Ticket asignado manualmente a ${updated.tecnico_nombre || updated.tecnico || 'técnico seleccionado'}.`);
    } catch (error) {
      setAssignmentError(error.response?.data?.error || error.response?.data?.message || 'No se pudo asignar manualmente el ticket.');
    } finally {
      setAssigning(false);
    }
  };

  const ratings = useMemo(() => {
    return normalizeRatings(remoteRatings || selectedTicket?.ratings || selectedTicket?.legacyRatings || {});
  }, [remoteRatings, selectedTicket]);

  if (!selectedTicket) {
    return <div className="panel empty-state-card"><strong>No hay ticket seleccionado.</strong></div>;
  }

  const ticketForView = workingTicket;
  const assignmentMeta = getAssignmentMeta(ticketForView);
  const skippedCandidates = ticketForView.skipped_candidates || assignmentMeta.skipped_candidates || assignmentMeta.skippedCandidates || [];
  const netMinutes = Math.round((ticketForView.duracion_neta_segundos || 0) / 60);
  const diagnostic = normalizeDiagnostic(ticketForView);

  return (
    <div className="panel ticket-detail-panel">
      <div className="ticket-title-row">
        <h3>Ticket #{String(ticketForView.id).padStart(6, '0')}</h3>
        <span className={`priority ${ticketForView.prioridad}`}>{priorityLabel(ticketForView.prioridad)}</span>
        <span className="status-pill">{ticketForView.estado}</span>
      </div>

      <h4>{ticketForView.titulo_tecnico || ticketForView.titulo || `${ticketForView.solicitante || 'Asociado'} / ${ticketForView.categoria || 'Categoría'}`}</h4>
      <p>{ticketForView.descripcion}</p>

      <div className="ticket-meta">
        <div><span>Solicitante</span><b>{ticketForView.solicitante}</b></div>
        <div><span>Categoría</span><b>{ticketForView.categoria}</b></div>
        <div><span>Creado</span><b>{formatDateTime(ticketForView.created_at || ticketForView.t_apertura || ticketForView.createdAt) || `${ticketForView.fecha} ${ticketForView.hora}`}</b></div>
        <div><span>Tiempo Neto</span><b>{netMinutes} min</b></div>
        <div><span>SLA</span><b>{ticketForView.sla_objetivo_minutos || 0} min</b></div>
      </div>

      <div className={`ticket-assignment-card ${isUnassigned(ticketForView) ? 'warning' : 'ok'}`}>
        <div className="assignment-card-head">
          <div>
            <span>Asignación operativa</span>
            <h4>{isUnassigned(ticketForView) ? 'Sin técnico asignado' : ticketForView.tecnico || ticketForView.tecnico_nombre}</h4>
          </div>
          <i>{ticketForView.assignment_method || assignmentMeta.method || 'Automática'}</i>
        </div>

        <div className="assignment-card-grid">
          <div><span>Estado</span><b>{ticketForView.assignment_status || (isUnassigned(ticketForView) ? 'Bolsa de espera' : 'Asignado')}</b></div>
          <div><span>Motivo</span><b>{getAssignmentMessage(ticketForView)}</b></div>
          <div><span>Carga</span><b>{ticketForView.active_load ?? assignmentMeta.active_load ?? '—'} / {ticketForView.max_active_tickets ?? assignmentMeta.max_active_tickets ?? '—'}</b></div>
          <div><span>Estado ticket</span><b>{statusLabel(ticketForView.estado)}</b></div>
        </div>

        {skippedCandidates.length > 0 && (
          <div className="assignment-skipped-list">
            <strong>Técnicos saltados por el motor</strong>
            {skippedCandidates.slice(0, 4).map((candidate, index) => (
              <span key={`${candidate.tecnico_id || candidate.id || index}`}>
                {candidate.name || candidate.full_name || candidate.tecnico || `Candidato ${index + 1}`} · {candidate.reason || candidate.motivo || candidate.reason_message || 'No elegible'}
              </span>
            ))}
          </div>
        )}

        {adminTechnicians.length > 0 && (
          <div className="assignment-admin-tools">
            <button type="button" onClick={retryAssignment} disabled={assigning}>
              {assigning ? 'Procesando...' : 'Reintentar automático'}
            </button>
            <button type="button" onClick={simulateAssignment} disabled={assigning}>
              Simular asignación
            </button>
            <select value={manualTechId} onChange={(event) => setManualTechId(event.target.value)}>
              <option value="">Asignar manualmente a...</option>
              {adminTechnicians.map((tech) => (
                <option key={tech.id} value={tech.id}>{getTechName(tech)}</option>
              ))}
            </select>
            <input
              value={manualReason}
              onChange={(event) => setManualReason(event.target.value)}
              placeholder="Motivo de asignación manual"
            />
            <button type="button" onClick={manualAssign} disabled={assigning || !manualTechId || !manualReason.trim()}>
              Asignar
            </button>
          </div>
        )}

        {assignmentError && <div className="assignment-inline-error">⚠ {assignmentError}</div>}
        {assignmentSuccess && <div className="assignment-inline-success">✓ {assignmentSuccess}</div>}

        {assignmentView && (
          <div className="assignment-simulation-box">
            <div className="assignment-simulation-head">
              <strong>Simulación del motor inteligente</strong>
              <button type="button" onClick={() => setAssignmentView(null)}>Ocultar</button>
            </div>
            <p>
              Recomendado:{' '}
              <b>
                {assignmentView.recommended?.full_name ||
                  assignmentView.wouldAssignTo?.full_name ||
                  assignmentView.selected_technician_name ||
                  assignmentView.selectedTechnician?.full_name ||
                  'Sin técnico recomendado'}
              </b>
            </p>
            <div className="assignment-candidate-list">
              {(assignmentView.candidates || assignmentView.candidatos || []).map((candidate, index) => (
                <span className={candidate.elegible || candidate.eligible ? 'ok' : 'blocked'} key={`${candidate.id || candidate.tecnico_id || index}`}>
                  <b>{candidate.full_name || candidate.name || candidate.tecnico || `Candidato ${index + 1}`}</b>
                  {candidate.elegible || candidate.eligible ? 'Elegible' : candidate.reason || candidate.motivo || candidate.reason_message || candidate.razones_exclusion?.join(', ') || 'No elegible'}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {diagnostic && (
        <div className="ticket-diagnostic-snapshot">
          <h4>Diagnóstico guardado</h4>
          <div className="ticket-diagnostic-row"><span>Categoría</span><b>{diagnostic.category || '—'}</b></div>
          <div className="ticket-diagnostic-row"><span>Etiqueta</span><b>{diagnostic.tag || '—'}</b></div>
          <div className="ticket-diagnostic-row"><span>SLA usado</span><b>{diagnostic.sla ? `${diagnostic.sla} min` : '—'}</b></div>
          <div className="ticket-diagnostic-row"><span>Prioridad interna</span><b>{priorityLabel(diagnostic.priority)}{diagnostic.score ? ` · ${diagnostic.score} pts` : ''}</b></div>
          {diagnostic.rows.map((row, index) => (
            <div className="ticket-diagnostic-row" key={`${row.question}-${index}`}>
              <span>{row.question}</span>
              <b>{String(row.answer || '—')}{row.score !== null && row.score !== undefined ? ` · ${row.score} pts` : ''}</b>
            </div>
          ))}
        </div>
      )}

      <div className="tabs">
        <button className={activeTab === 'messages' ? 'active' : ''} onClick={() => setActiveTab('messages')}>Bitácora ({messages.length})</button>
        <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>Historial de SLA ({history.length})</button>
        <button className={activeTab === 'ratings' ? 'active' : ''} onClick={() => setActiveTab('ratings')}>Calificaciones</button>
      </div>

      <div className="chat-box">
        {activeTab === 'messages' && (
          <>
            {messages.map((message) => (
              <ChatMessage
                key={message.id || message.timestamp || message.created_at}
                name={message.emisor_nombre || message.sender_name || 'Sistema'}
                role={message.tipo_mensaje || message.message_type || 'Registro'}
                text={message.mensaje || message.message || ''}
                time={message.timestamp || message.created_at ? new Date(message.timestamp || message.created_at).toLocaleTimeString('es-NI', { timeZone: 'America/Managua', hour: '2-digit', minute: '2-digit' }) : ''}
              />
            ))}
            {!messages.length && <div className="empty-state-card"><strong>Sin mensajes registrados.</strong></div>}
          </>
        )}

        {activeTab === 'history' && (
          <div className="ticket-history-timeline">
            {historyError && <div className="timeline-error-banner">No se pudo sincronizar el historial del ticket.</div>}

            {history.map((event, index) => (
              <div className="timeline-item" key={event.id || `${event.created_at}-${index}`}>
                <div className="timeline-marker" />
                <div className="timeline-content">
                  <div className="timeline-header">
                    <strong className="timeline-actor">{event.actor_name || event.changed_by_name || 'Sistema'}</strong>
                    <span className={`timeline-role-badge ${String(event.actor_role || '').toLowerCase()}`}>{event.actor_role || 'sistema'}</span>
                    <span className="timeline-date">
                      {event.created_at ? new Date(event.created_at).toLocaleString('es-NI', { timeZone: 'America/Managua', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''}
                    </span>
                  </div>
                  <div className="timeline-change-row">
                    {event.from_status ? (
                      <>
                        <span className="status-old">{event.from_status}</span>
                        <span className="status-arrow">→</span>
                      </>
                    ) : null}
                    <span className="status-new">{event.to_status}</span>
                  </div>
                  {event.reason && <p className="timeline-reason">“{event.reason}”</p>}
                </div>
              </div>
            ))}

            {!history.length && !historyError && <div className="empty-state-card"><strong>Sin historial de transiciones para este ticket.</strong></div>}
          </div>
        )}

        {activeTab === 'ratings' && (
          <div className="ratings-grid">
            <RatingCard
              title="Asociado → Técnico"
              rating={ratings.associate_to_technician}
              pendingText="Pendiente de calificación por parte del asociado."
              actor={ticketForView.solicitante}
            />
            <RatingCard
              title="Técnico → Asociado"
              rating={ratings.technician_to_associate}
              pendingText="Pendiente de calificación por parte del técnico."
              actor={ticketForView.tecnico}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function RatingCard({ title, rating, pendingText, actor }) {
  const score = getRatingScore(rating);
  const comment = getRatingComment(rating);

  return (
    <div className="rating-card">
      <h5>{title}</h5>
      {score > 0 ? (
        <>
          <div className="stars-readonly">{'★'.repeat(score)}{'☆'.repeat(Math.max(0, 5 - score))}</div>
          <p>“{comment || 'Sin comentario registrado.'}”</p>
          <small>Calificado por: {actor || 'Usuario'}</small>
        </>
      ) : (
        <p className="muted">{pendingText}</p>
      )}
    </div>
  );
}

function ChatMessage({ name, role, text, time }) {
  return (
    <div className="chat-message">
      <div className="mini-avatar">👨</div>
      <div><strong>{name} <span>({role})</span></strong><p>{text}</p></div>
      <small>{time}</small>
    </div>
  );
}

export default TicketDetail;
