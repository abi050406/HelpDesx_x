import { useCallback, useMemo, useState } from 'react';
import PageHeader from './PageHeader';
import { priorityLabel, statusLabel } from '../../data/helpdeskData';

function getTechName(tech) {
  return tech?.full_name || tech?.name || tech?.username || 'Técnico';
}

function isUnassigned(ticket) {
  const techName = String(ticket?.tecnico || ticket?.tecnico_nombre || '').trim().toLowerCase();
  return !ticket?.tecnico_id && (!techName || techName === 'sin asignar' || techName === 'null');
}

function assignmentMessage(ticket) {
  const code = ticket?.assignment_reason || ticket?.assignment_status;
  const messages = {
    NO_ASSIGNMENT_RULE: 'No existe regla para la categoría.',
    NO_ACTIVE_PRESENCE: 'No hay técnicos con presencia activa.',
    TECHNICIANS_AT_CAPACITY: 'Todos los técnicos elegibles están al límite de capacidad.',
    TECHNICIANS_BUSY_HIGH_PRIORITY: 'Técnicos ocupados con tickets de alta prioridad.',
    SLA_RISK: 'Riesgo de SLA detectado.',
    NO_ELIGIBLE_TECHNICIAN: 'No hay técnico elegible.',
    waiting_pool: 'Ticket en bolsa de espera.',
  };

  return ticket?.assignment_reason_message || ticket?.assignment_message || ticket?.motivo_asignacion_texto || messages[code] || '';
}

function TicketsPage({
  tickets,
  title = 'Tickets',
  subtitle = 'Gestión operativa de solicitudes de soporte.',
  role = 'guest',
  onSelectTicket,
  showCreate = false,
  onCreate,
  technicians = [],
  onRetryAssignment,
  onAssignTicket,
  onSimulateAssignment,
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [group, setGroup] = useState('active');
  const [assignModal, setAssignModal] = useState(null);
  const [manualTechId, setManualTechId] = useState('');
  const [manualReason, setManualReason] = useState('Asignación manual por administrador');
  const [assignmentResult, setAssignmentResult] = useState(null);
  const [assignmentError, setAssignmentError] = useState('');
  const [assignmentLoading, setAssignmentLoading] = useState(false);

  const isAssociate = String(role || '').toLowerCase() === 'associate';
  const isAdmin = String(role || '').toLowerCase() === 'admin';

  const isClosed = useCallback((ticket) => ['Resuelto', 'Cerrado'].includes(statusLabel(ticket.estado)), []);

  const groupOptions = useMemo(() => [
    { id: 'active', label: 'Activos', count: tickets.filter((ticket) => !isClosed(ticket)).length },
    { id: 'new', label: 'Pendientes', count: tickets.filter((ticket) => statusLabel(ticket.estado) === 'Abierto').length },
    {
      id: 'progress',
      label: 'En progreso',
      count: tickets.filter((ticket) => ['En Progreso', 'En Espera', 'Planificado'].includes(statusLabel(ticket.estado))).length,
    },
    { id: 'history', label: 'Resueltos / cerrados', count: tickets.filter(isClosed).length },
    { id: 'all', label: 'Todos', count: tickets.length },
  ], [tickets, isClosed]);

  const visibleTickets = useMemo(() => tickets.filter((ticket) => {
    const haystack = `${ticket.id} ${ticket.titulo} ${ticket.solicitante} ${ticket.tecnico} ${ticket.categoria} ${assignmentMessage(ticket)}`.toLowerCase();
    const matchesSearch = haystack.includes(search.trim().toLowerCase());
    const matchesStatus = status === 'all' || statusLabel(ticket.estado) === status;
    const label = statusLabel(ticket.estado);

    const matchesGroup = group === 'all'
      || (group === 'active' && !isClosed(ticket))
      || (group === 'new' && label === 'Abierto')
      || (group === 'progress' && ['En Progreso', 'En Espera', 'Planificado'].includes(label))
      || (group === 'history' && isClosed(ticket));

    return matchesSearch && matchesStatus && matchesGroup;
  }), [tickets, search, status, group, isClosed]);

  const openAssignModal = (ticket) => {
    setAssignModal(ticket);
    setManualTechId('');
    setManualReason('Asignación manual por administrador');
    setAssignmentResult(null);
    setAssignmentError('');
  };

  const retryAssignment = async (ticket) => {
    if (!onRetryAssignment) return;

    setAssignmentLoading(true);
    setAssignmentError('');
    setAssignmentResult(null);

    try {
      const result = await onRetryAssignment(ticket.id);
      setAssignmentResult(result || { message: 'Reintento ejecutado.' });
    } catch (error) {
      setAssignmentError(error?.response?.data?.error || error?.message || 'No se pudo reintentar la asignación.');
    } finally {
      setAssignmentLoading(false);
    }
  };

  const simulateAssignment = async (ticket) => {
    if (!onSimulateAssignment) return;

    setAssignmentLoading(true);
    setAssignmentError('');
    setAssignmentResult(null);

    try {
      const result = await onSimulateAssignment(ticket.id);
      setAssignmentResult(result || { message: 'Simulación ejecutada.' });
    } catch (error) {
      setAssignmentError(error?.response?.data?.error || error?.message || 'No se pudo simular la asignación.');
    } finally {
      setAssignmentLoading(false);
    }
  };

  const assignManually = async () => {
    if (!assignModal || !manualTechId || !manualReason.trim()) {
      setAssignmentError('Selecciona técnico y escribe el motivo.');
      return;
    }

    setAssignmentLoading(true);
    setAssignmentError('');

    try {
      await onAssignTicket?.(assignModal.id, manualTechId, manualReason.trim());
      setAssignModal(null);
    } catch (error) {
      setAssignmentError(error?.response?.data?.error || error?.message || 'No se pudo asignar manualmente.');
    } finally {
      setAssignmentLoading(false);
    }
  };

  return (
    <section className={`module-page ${isAssociate ? 'associate-ticket-list' : ''}`}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actionLabel={showCreate ? '+ Nuevo Ticket' : null}
        onAction={onCreate}
      />

      <div className="ticket-status-tabs" aria-label="Segmentos de tickets">
        {groupOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={group === option.id ? 'active' : ''}
            onClick={() => setGroup(option.id)}
          >
            {option.label} <span>{option.count}</span>
          </button>
        ))}
      </div>

      <div className="module-toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por ID, usuario, técnico, categoría o motivo..."
        />

        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">Todos los estados</option>
          <option>Abierto</option>
          <option>En Progreso</option>
          <option>En Espera</option>
          <option>Planificado</option>
          <option>Resuelto</option>
          <option>Cerrado</option>
        </select>
      </div>

      <div className={`module-table ${isAssociate ? 'no-priority-table' : ''} smart-ticket-table`}>
        <div className={`module-row head ${isAssociate ? 'associate-row' : ''}`}>
          <span>ID</span>
          <span>Título</span>
          {!isAssociate && <span>Prioridad</span>}
          <span>Estado</span>
          <span>Técnico</span>
          <span>Acción</span>
        </div>

        {visibleTickets.map((ticket) => {
          const unassigned = isUnassigned(ticket);
          const message = assignmentMessage(ticket);

          return (
            <div className={`module-row ${isAssociate ? 'associate-row' : ''} ${unassigned ? 'ticket-unassigned-row' : ''}`} key={ticket.id}>
              <span>#{String(ticket.id).padStart(6, '0')}</span>

              <span>
                <b>{ticket.titulo}</b>
                <small>{ticket.solicitante} · {ticket.categoria}</small>
                {unassigned && message && (
                  <small className="assignment-reason-line">⚠ {message}</small>
                )}
              </span>

              {!isAssociate && (
                <span>
                  <i className={`priority ${ticket.prioridad}`}>
                    {priorityLabel(ticket.prioridad)}
                  </i>
                </span>
              )}

              <span>
                <i className="soft-pill">{statusLabel(ticket.estado)}</i>
              </span>

              <span>
                <b>{unassigned ? 'Sin asignar' : ticket.tecnico}</b>
                {!unassigned && ticket.assignment_method && <small>{ticket.assignment_method}</small>}
              </span>

              <span className="ticket-actions-cell">
                <button type="button" onClick={() => onSelectTicket?.(ticket.id)}>
                  Ver detalle
                </button>

                {isAdmin && unassigned && (
                  <>
                    <button type="button" className="ghost-mini-btn" onClick={() => retryAssignment(ticket)} disabled={assignmentLoading}>
                      Reintentar
                    </button>
                    <button type="button" className="ghost-mini-btn" onClick={() => {
                      openAssignModal(ticket);
                      simulateAssignment(ticket);
                    }}>
                      Asignar
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}

        {!visibleTickets.length && (
          <div className="table-empty-state">
            No hay tickets que coincidan con los filtros.
          </div>
        )}
      </div>

      {assignmentResult && !assignModal && (
        <div className="assignment-floating-result">
          <button type="button" onClick={() => setAssignmentResult(null)}>×</button>
          <strong>Resultado de asignación</strong>
          <pre>{JSON.stringify(assignmentResult, null, 2)}</pre>
        </div>
      )}

      {assignModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="resolved-modal assignment-modal">
            <button className="modal-close" type="button" onClick={() => setAssignModal(null)}>×</button>

            <h2>Asignar ticket #{String(assignModal.id).padStart(6, '0')}</h2>
            <p>{assignModal.titulo} · {assignModal.categoria}</p>

            {assignmentResult && (
              <div className="assignment-simulation-box">
                <strong>Simulación del motor inteligente</strong>
                <p>
                  Recomendado:{' '}
                  <b>
                    {assignmentResult.recommended?.full_name ||
                      assignmentResult.wouldAssignTo?.full_name ||
                      assignmentResult.selected_technician_name ||
                      assignmentResult.selectedTechnician?.full_name ||
                      'Sin técnico recomendado'}
                  </b>
                </p>

                <div className="assignment-candidate-list">
                  {(assignmentResult.candidates || assignmentResult.candidatos || []).map((candidate, index) => (
                    <span className={candidate.elegible || candidate.eligible ? 'ok' : 'blocked'} key={`${candidate.id || candidate.tecnico_id || index}`}>
                      <b>{candidate.full_name || candidate.name || candidate.tecnico || `Candidato ${index + 1}`}</b>
                      {candidate.elegible || candidate.eligible ? 'Elegible' : candidate.reason || candidate.motivo || candidate.reason_message || candidate.razones_exclusion?.join(', ') || 'No elegible'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <label className="assignment-modal-field">
              Técnico destino
              <select value={manualTechId} onChange={(event) => setManualTechId(event.target.value)}>
                <option value="">Selecciona técnico</option>
                {technicians.map((tech) => (
                  <option key={tech.id} value={tech.id}>{getTechName(tech)}</option>
                ))}
              </select>
            </label>

            <label className="assignment-modal-field">
              Motivo
              <input
                value={manualReason}
                onChange={(event) => setManualReason(event.target.value)}
                placeholder="Ej. Redistribución por carga activa"
              />
            </label>

            {assignmentError && <div className="assignment-inline-error">⚠ {assignmentError}</div>}

            <div className="modal-actions assignment-modal-actions">
              <button type="button" className="green" onClick={assignManually} disabled={assignmentLoading || !manualTechId || !manualReason.trim()}>
                {assignmentLoading ? 'Asignando...' : 'Asignar manualmente'}
              </button>
              <button type="button" className="red" onClick={() => retryAssignment(assignModal)} disabled={assignmentLoading}>
                Reintentar automático
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default TicketsPage;
