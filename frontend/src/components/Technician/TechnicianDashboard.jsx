import { useMemo, useState } from 'react';
import { Metric, Notification, Technician } from '../Shared';
import { priorityLabel, statusLabel } from '../../data/helpdeskData';
import { TechnicianResolveModal } from '../Shared/Modals';

const priorityOrder = { critica: 1, alta: 2, media: 3, baja: 4 };

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isResolved(ticket) {
  const estado = normalizeKey(ticket?.estado);
  return estado.trim() === 'resuelto' || estado.trim() === 'cerrado';
}

function isInProgress(ticket) {
  const state = normalizeKey(ticket?.estado).trim().replace(/_/g, ' ');
  return state === 'en progreso';
}

function isWaiting(ticket) {
  return normalizeKey(ticket?.estado).trim().replace(/_/g, ' ') === 'en espera';
}

function isPlanned(ticket) {
  const state = normalizeKey(ticket?.estado).trim();
  return state === 'planificado' || state === 'planificada';
}

function ticketPriority(ticket) {
  const key = normalizeKey(ticket?.prioridad || 'media');

  if (key.includes('crit')) return 'critica';
  if (key.includes('alt')) return 'alta';
  if (key.includes('baj')) return 'baja';

  return 'media';
}

function sortByPriority(a, b) {
  return (
    (priorityOrder[ticketPriority(a)] || 9) -
      (priorityOrder[ticketPriority(b)] || 9) ||
    Number(b.id) - Number(a.id)
  );
}

function TechnicianDashboard({
  tickets,
  currentUser,
  techStatus,
  selectedTicket,
  setSelectedId,
  setToast,
  onTicketAction,
  onSendMessage,
}) {
  const [priorityFilter, setPriorityFilter] = useState('todos');
  const [localSelectedId, setLocalSelectedId] = useState(selectedTicket?.id || tickets[0]?.id);
  const [resolvingTicket, setResolvingTicket] = useState(null);
  const [planningTicket, setPlanningTicket] = useState(null);

  const myTickets = useMemo(() => {
    const techName = normalizeKey(currentUser?.name || 'Juan Pérez');

    const assigned = tickets.filter((ticket) => {
      const ticketTech = normalizeKey(ticket.tecnico || ticket.assigned_to || '');
      const matchesId =
        ticket.tecnico_id != null &&
        currentUser?.id != null &&
        Number(ticket.tecnico_id) === Number(currentUser.id);

      return matchesId || ticketTech.includes(techName);
    });

    return assigned.slice().sort(sortByPriority);
  }, [tickets, currentUser]);

  const workQueue = useMemo(() => {
    return myTickets.filter((ticket) => !isResolved(ticket));
  }, [myTickets]);

  const filteredTickets = useMemo(() => {
    if (priorityFilter === 'todos') return workQueue;
    return workQueue.filter((ticket) => ticketPriority(ticket) === priorityFilter);
  }, [workQueue, priorityFilter]);

  const firstWorkableTicket = workQueue[0];

  const activeTicket =
    workQueue.find((ticket) => ticket.id === localSelectedId) ||
    workQueue.find((ticket) => ticket.id === selectedTicket?.id) ||
    firstWorkableTicket;

  const metrics = {
    assigned: workQueue.length,
    progress: myTickets.filter(isInProgress).length,
    waiting: myTickets.filter(isWaiting).length,
    resolved: myTickets.filter(isResolved).length,
  };

  const counts = {
    todos: workQueue.length,
    critica: workQueue.filter((ticket) => ticketPriority(ticket) === 'critica').length,
    alta: workQueue.filter((ticket) => ticketPriority(ticket) === 'alta').length,
    media: workQueue.filter((ticket) => ticketPriority(ticket) === 'media').length,
    baja: workQueue.filter((ticket) => ticketPriority(ticket) === 'baja').length,
  };

  const selectTicket = (ticket) => {
    const criticalPending = workQueue.find((item) => ticketPriority(item) === 'critica');

    if (
      criticalPending &&
      ticketPriority(ticket) !== 'critica' &&
      !window.confirm('Atención: posee incidentes críticos pendientes. ¿Desea posponerlos?')
    ) {
      return;
    }

    setLocalSelectedId(ticket.id);
    setSelectedId(ticket.id);
  };

  const handleAction = (action, payload = {}, targetTicket = activeTicket) => {
    if (!targetTicket?.id) return;

    if (typeof onTicketAction === 'function') {
      onTicketAction(targetTicket.id, action, payload);
      return;
    }

    setToast(`Acción simulada: ${action} ticket #${String(targetTicket.id).padStart(6, '0')}`);
  };

  return (
    <div className="tech-dashboard tech-dashboard-functional">
      <section className="tech-main">
        <section className="kpi-grid tech-kpis">
          <Metric icon="☑" title="Asignados" value={metrics.assigned} trend="Ver todos" tone="blue" />
          <Metric icon="⌛" title="En Progreso" value={metrics.progress} trend="Ver todos" tone="orange" />
          <Metric icon="▣" title="En Espera" value={metrics.waiting} trend="Ver todos" tone="yellow" />
          <Metric icon="✓" title="Resueltos" value={metrics.resolved} trend="Ver todos" tone="green" />
        </section>

        <div className="tech-work-grid">
          <div className="panel priority-panel">
            <div className="panel-head">
              <div>
                <h3>Mis Tickets Prioritarios</h3>
                <p>Orden obligatorio por gravedad: crítica, alta, media y baja.</p>
              </div>
              <span className={`live-pill ${normalizeKey(techStatus)}`}>● {techStatus}</span>
            </div>

            <div className="filters tabs-line tech-tabs">
              {[
                ['todos', `Todos (${counts.todos})`],
                ['critica', `Críticos (${counts.critica})`],
                ['alta', `Altos (${counts.alta})`],
                ['media', `Medios (${counts.media})`],
                ['baja', `Bajos (${counts.baja})`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={priorityFilter === key ? 'active' : ''}
                  onClick={() => setPriorityFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="priority-list">
              {filteredTickets.map((ticket) => {
                const p = ticketPriority(ticket);
                const selected = activeTicket?.id === ticket.id;

                return (
                  <button
                    key={ticket.id}
                    className={`priority-ticket ${p} ${selected ? 'selected' : ''}`}
                    onClick={() => selectTicket(ticket)}
                  >
                    <div>
                      <strong>
                        #{String(ticket.id).padStart(6, '0')}{' '}
                        <span className={`priority ${p}`}>{priorityLabel(p)}</span>
                      </strong>
                      <h4>{ticket.titulo_tecnico || ticket.titulo}</h4>
                      <p>{ticket.solicitante} · {ticket.categoria}</p>
                    </div>
                    <span className={`status-badge ${normalizeKey(ticket.estado).replace(/\s+/g, '-')}`}>
                      {statusLabel(ticket.estado)}
                    </span>
                  </button>
                );
              })}

              {!filteredTickets.length && (
                <div className="empty-state-card">
                  <strong>No hay tickets en este filtro.</strong>
                  <p>Cambia el filtro o espera nueva asignación.</p>
                </div>
              )}
            </div>
          </div>

          <TicketFocusCard
            ticket={activeTicket}
            onAction={(action, payload) => handleAction(action, payload, activeTicket)}
            onSendMessage={onSendMessage}
            onResolveClick={() => setResolvingTicket(activeTicket)}
            onPlanClick={() => setPlanningTicket(activeTicket)}
          />
        </div>

        <TechnicianStats metrics={metrics} tickets={myTickets} />

        <div className="tip-bar">
          💡 <b>Consejo del día:</b> Documenta casos especiales resueltos para alimentar la Wiki-TI.{' '}
          <button>Ir a Wiki-TI</button>
        </div>
      </section>

      <aside className="tech-right">
        <ActivityPanel tickets={myTickets} />
        <RemindersPanel tickets={myTickets} />
        <TechnicianStatusPanel current={techStatus} currentUser={currentUser} tickets={myTickets} />
      </aside>

      {resolvingTicket && (
        <TechnicianResolveModal
          ticket={resolvingTicket}
          onResolveSubmit={(payload) => {
            handleAction('resolve', payload, resolvingTicket);
            setResolvingTicket(null);
          }}
          onClose={() => setResolvingTicket(null)}
        />
      )}

      {planningTicket && (
        <TechnicianPlanModal
          ticket={planningTicket}
          onClose={() => setPlanningTicket(null)}
          onPlanSubmit={(payload) => {
            handleAction('plan', payload, planningTicket);
            setPlanningTicket(null);
          }}
        />
      )}
    </div>
  );
}

function TicketFocusCard({ ticket, onAction, onSendMessage, onResolveClick, onPlanClick }) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('Nota Técnica');

  if (!ticket) {
    return (
      <div className="panel ticket-focus">
        <h3>Sin ticket seleccionado</h3>
        <p>No hay tickets disponibles para este técnico.</p>
      </div>
    );
  }

  const p = ticketPriority(ticket);
  const estadoKey = normalizeKey(ticket.estado);
  const inProgress = estadoKey.includes('proceso') || estadoKey.includes('progreso');
  const canStart = !inProgress && !estadoKey.includes('resuelto') && !estadoKey.includes('cerrado');
  const canResolve = inProgress || estadoKey.includes('espera') || estadoKey.includes('plan');

  return (
    <div className="panel ticket-focus">
      <div className="ticket-focus-head">
        <div>
          <span className={`priority ${p}`}>{priorityLabel(p)}</span>
          <h3>#{String(ticket.id).padStart(6, '0')} · {ticket.titulo_tecnico || ticket.titulo}</h3>
          <p>{ticket.descripcion}</p>
        </div>
        <span className={`status-badge ${estadoKey.replace(/\s+/g, '-')}`}>
          {statusLabel(ticket.estado)}
        </span>
      </div>

      <div className="ticket-focus-meta">
        <div>
          <span>Solicitante</span>
          <b>{ticket.solicitante}</b>
        </div>
        <div>
          <span>Categoría</span>
          <b>{ticket.categoria}</b>
        </div>
        <div>
          <span>Fecha</span>
          <b>{ticket.fecha}</b>
        </div>
        <div>
          <span>Hora</span>
          <b>{ticket.hora}</b>
        </div>

        {isPlanned(ticket) && (
          <div>
            <span>Planificado para</span>
            <b>{formatPlannedDate(ticket.fecha_planificada || ticket.planned_at || ticket.scheduledAt)}</b>
          </div>
        )}
      </div>

      <div className="ticket-focus-actions">
        <button className="primary" disabled={!canStart} onClick={() => onAction('start')}>
          Iniciar Atención
        </button>

        <button className="warning" disabled={!canResolve} onClick={() => onAction('wait')}>
          Pasar a Espera
        </button>

        <button className="blue" disabled={isResolved(ticket)} onClick={onPlanClick}>
          Planificar
        </button>

        <button className="success" disabled={!canResolve} onClick={onResolveClick}>
          Resolver
        </button>

        <button className="red" disabled={isResolved(ticket)} onClick={() => setRejecting(true)}>
          Rechazar
        </button>
      </div>

      <div className="ticket-chat-preview">
        <strong>Bitácora rápida</strong>
        <p>
          <b>Técnico:</b> Revisando caso y validando causa raíz.
        </p>

        <div className="message-type-tabs">
          {['Nota Técnica', 'Actualización', 'Escalamiento', 'General'].map((type) => (
            <button
              className={messageType === type ? 'active' : ''}
              key={type}
              onClick={() => setMessageType(type)}
            >
              {type}
            </button>
          ))}
        </div>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Escribe una nota interna..."
        />

        <button
          className="link-btn"
          disabled={!message.trim()}
          onClick={async () => {
            await onSendMessage?.(ticket.id, message, messageType);
            setMessage('');
          }}
        >
          Guardar en bitácora
        </button>
      </div>

      {rejecting && (
        <div className="modal-backdrop">
          <div className="resolved-modal">
            <h2>Rechazar ticket</h2>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Motivo obligatorio..."
            />
            <div className="modal-actions">
              <button
                className="red"
                disabled={!rejectReason.trim()}
                onClick={() => {
                  onAction('reject', { reason: rejectReason });
                  setRejecting(false);
                }}
              >
                Confirmar rechazo
              </button>
              <button onClick={() => setRejecting(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TechnicianStats({ metrics, tickets }) {
  const measured = tickets.filter((ticket) => ticket.duracion_neta_segundos > 0);
  const averageMinutes = Math.round(
    measured.reduce((sum, ticket) => sum + ticket.duracion_neta_segundos, 0) /
      Math.max(1, measured.length) /
      60
  );

  return (
    <div className="panel stats-panel">
      <div className="panel-head">
        <h3>Estadísticas Personales</h3>
      </div>

      <div className="stat-strip">
        <div>
          <span>Tiempo Neto Promedio</span>
          <b>{averageMinutes} min</b>
          <small>Tickets con medición</small>
        </div>
        <div>
          <span>Tickets Resueltos</span>
          <b>{metrics.resolved}</b>
          <small>Historial asignado</small>
        </div>
        <div>
          <span>Carga Activa</span>
          <b>{metrics.assigned}</b>
          <small>Tickets pendientes</small>
        </div>
      </div>

      <div className="mini-heatmap" aria-label="Mapa de calor personal">
        {Array.from({ length: 42 }, (_, index) => (
          <span
            key={index}
            style={{
              opacity: 0.18 + ((tickets?.[index % Math.max(tickets.length, 1)] ? 1 : 0) * 0.45),
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ActivityPanel({ tickets }) {
  const activity = tickets.slice(0, 4).map((ticket) => ({
    type: isResolved(ticket)
      ? 'success'
      : ticketPriority(ticket) === 'critica'
        ? 'danger'
        : ticketPriority(ticket) === 'alta'
          ? 'warning'
          : 'info',
    title: isResolved(ticket) ? 'Ticket resuelto' : 'Ticket asignado',
    text: `#${String(ticket.id).padStart(6, '0')} · ${ticket.titulo_tecnico || ticket.titulo}`,
    time: ticket.hora,
  }));

  return (
    <div className="panel activity-panel">
      <h3>Actividad Reciente</h3>

      {activity.map((item) => (
        <Notification key={item.text} item={item} />
      ))}

      {!activity.length && (
        <div className="empty-state-card">
          <strong>Sin actividad reciente.</strong>
        </div>
      )}

      <button className="link-btn">Ver toda la actividad →</button>
    </div>
  );
}

function RemindersPanel({ tickets }) {
  const waiting = tickets.filter(isWaiting).length;
  const planned = tickets.filter(isPlanned).length;
  const critical = tickets.filter((ticket) => ticketPriority(ticket) === 'critica' && !isResolved(ticket)).length;

  return (
    <div className="panel reminders-panel">
      <h3>Recordatorios</h3>
      <p>⚠ {waiting} tickets en espera</p>
      <p>📅 {planned} tickets planificados</p>
      <p>🚨 {critical} incidentes críticos abiertos</p>
      <button className="link-btn">Ver recordatorios →</button>
    </div>
  );
}

function TechnicianStatusPanel({ current, currentUser, tickets }) {
  return (
    <div className="panel tech-status-panel">
      <h3>Mi estado actual</h3>
      <Technician
        tech={{
          name: currentUser?.name || 'Técnico',
          state: current,
          tickets: tickets.filter((ticket) => !isResolved(ticket)).length,
        }}
      />
    </div>
  );
}

function getTicketCreatedDate(ticket) {
  const rawDate =
    ticket?.t_apertura ||
    ticket?.created_at ||
    ticket?.createdAt ||
    ticket?.fecha_creacion ||
    ticket?.fecha_apertura ||
    ticket?.fecha;

  if (!rawDate) return null;

  const isoDate = new Date(rawDate);
  if (!Number.isNaN(isoDate.getTime())) return isoDate;

  const match = String(rawDate).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function formatPlannedDate(value) {
  if (!value) return 'Fecha pendiente';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString('es-NI', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TechnicianPlanModal({ ticket, onPlanSubmit, onClose }) {
  const [plannedAt, setPlannedAt] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const createdDate = getTicketCreatedDate(ticket);

  const submit = async () => {
    setError('');

    if (!plannedAt) {
      setError('Seleccione una fecha y hora para planificar el ticket.');
      return;
    }

    const selectedDate = new Date(plannedAt);

    if (Number.isNaN(selectedDate.getTime())) {
      setError('La fecha seleccionada no es válida.');
      return;
    }

    if (createdDate && selectedDate < createdDate) {
      setError('La fecha planificada no puede ser anterior a la creación del ticket.');
      return;
    }

    setSaving(true);

    try {
      await onPlanSubmit({
        fecha_planificada: plannedAt,
        plannedAt,
        planned_at: plannedAt,
        scheduledAt: plannedAt,
      });
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo planificar el ticket.');
    } finally {
      setSaving(false);
    }
  };

  const minDateTime = createdDate
    ? new Date(createdDate.getTime() - createdDate.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : '';

  return (
    <div className="modal-backdrop strict-backdrop" role="dialog" aria-modal="true">
      <div className="resolved-modal technician-plan-modal">
        <button className="modal-close" type="button" onClick={onClose} disabled={saving}>
          ×
        </button>

        <h2>Planificar Ticket #{String(ticket?.id || '').padStart(6, '0')}</h2>

        <p className="modal-subtitle">
          {ticket?.titulo_tecnico || `${ticket?.solicitante || 'Asociado'} / ${ticket?.categoria || 'Categoría'}`}
        </p>

        <div className="problem-preview">
          <span>Problema reportado:</span>
          <p>“{ticket?.descripcion_breve || ticket?.descripcion || 'Sin descripción disponible.'}”</p>
        </div>

        <label className="modal-field">
          <span>Fecha y hora planificada</span>
          <input
            type="datetime-local"
            value={plannedAt}
            min={minDateTime}
            onChange={(event) => {
              setPlannedAt(event.target.value);
              setError('');
            }}
            disabled={saving}
          />
          <small className={plannedAt ? 'field-ok' : 'field-hint'}>
            {plannedAt
              ? '✓ Fecha seleccionada'
              : 'Seleccione una fecha posterior a la creación del ticket.'}
          </small>
        </label>

        {createdDate && (
          <small className="field-hint">
            Ticket creado:{' '}
            {createdDate.toLocaleString('es-NI', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </small>
        )}

        {error && <p className="modal-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button className="green" type="button" onClick={submit} disabled={saving || !plannedAt}>
            {saving ? 'Planificando...' : 'Planificar ticket'}
          </button>
          <button className="red" type="button" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export default TechnicianDashboard;
