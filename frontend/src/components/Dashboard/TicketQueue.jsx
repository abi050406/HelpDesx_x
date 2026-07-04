import { priorityLabel } from '../../data/helpdeskData';

function TicketQueue({ tickets, metrics, selectedId, setSelectedId }) {
  const priorityCount = (needle) => tickets.filter((ticket) => ticket.prioridad.includes(needle)).length;
  return (
    <div className="panel ticket-list-panel">
      <div className="panel-head"><h3>Cola global de tickets</h3><button>⚙</button></div>
      <div className="filters"><span>Todos {metrics.total}</span><span>Críticos {priorityCount('crit')}</span><span>Altos {priorityCount('alta')}</span><span>Medios {priorityCount('media')}</span><span>Bajos {priorityCount('baja')}</span></div>
      <div className="ticket-list">
        {tickets.map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} selected={selectedId === ticket.id} onClick={() => setSelectedId(ticket.id)} />
        ))}
      </div>
      <button className="load-more">↻ Cargar más tickets</button>
    </div>
  );
}

function assignmentMessage(ticket) {
  const code = ticket.assignment_reason || ticket.assignment_status;
  const messages = {
    NO_ASSIGNMENT_RULE: 'Sin regla para la categoría',
    NO_ACTIVE_PRESENCE: 'Sin técnicos activos',
    TECHNICIANS_AT_CAPACITY: 'Técnicos saturados',
    TECHNICIANS_BUSY_HIGH_PRIORITY: 'Técnicos ocupados con alta prioridad',
    SLA_RISK: 'Riesgo de SLA',
    NO_ELIGIBLE_TECHNICIAN: 'Sin técnico elegible',
    waiting_pool: 'En bolsa de espera',
  };

  return ticket.assignment_reason_message || ticket.assignment_message || messages[code] || '';
}

function isUnassigned(ticket) {
  const techName = String(ticket.tecnico || ticket.tecnico_nombre || '').trim().toLowerCase();
  return !ticket.tecnico_id && (!techName || techName === 'sin asignar');
}

function TicketRow({ ticket, selected, onClick }) {
  return (
    <button className={`ticket-row ${ticket.prioridad} ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div>
        <strong>#{String(ticket.id).padStart(6, '0')}</strong>
        <h4>{ticket.titulo}</h4>
        <p>{ticket.descripcion}</p>
        {isUnassigned(ticket) && assignmentMessage(ticket) && (
          <em className="queue-assignment-reason">⚠ {assignmentMessage(ticket)}</em>
        )}
      </div>
      <div><span className={`priority ${ticket.prioridad}`}>{priorityLabel(ticket.prioridad)}</span><small>{ticket.hora}</small></div>
    </button>
  );
}

export default TicketQueue;
