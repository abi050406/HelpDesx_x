import { Metric } from '../Shared';
import { statusLabel } from '../../data/helpdeskData';

function AssociateDashboard({ tickets, onOpenResolved, onOpenTicket }) {
  const myTickets = tickets.slice(0, 5);

  const totals = tickets.reduce((result, ticket) => {
    const state = String(ticket.estado || '').toLowerCase();

    if (state.includes('resuelto') || state.includes('cerrado')) {
      result.resolved += 1;
    } else if (state.includes('progreso') || state.includes('proceso') || state.includes('plan')) {
      result.inProgress += 1;
    } else if (state.includes('abierto') || state.includes('nuevo')) {
      result.open += 1;
    }

    return result;
  }, { open: 0, inProgress: 0, resolved: 0 });

  const isResolved = (ticket) => {
    const state = String(ticket.estado || '').toLowerCase();
    return state.includes('resuelto');
  };

  return (
    <div className="associate-dashboard">
      <section className="associate-main">
        <section className="kpi-grid associate-kpis">
          <Metric icon="▢" title="Abiertos" value={totals.open} trend="Ver detalles" tone="blue" />
          <Metric icon="◷" title="En Progreso" value={totals.inProgress} trend="Ver detalles" tone="orange" />
          <Metric icon="✓" title="Resueltos" value={totals.resolved} trend="Ver detalles" tone="green" />
          <Metric icon="▣" title="Todos" value={tickets.length} trend="Ver detalles" tone="purple" />
        </section>

        <div className="panel associate-table">
          <div className="panel-head">
            <div className="tabs-line">
              <span>Todos</span>
              <span>Abiertos</span>
              <span>En Progreso</span>
              <span>Resueltos</span>
              <span>Cerrados</span>
            </div>

            <div className="table-tools">
              <input placeholder="Buscar tickets..." />
              <button type="button">⚿</button>
            </div>
          </div>

          {myTickets.map((ticket) => (
            <div
              key={ticket.id}
              className={`associate-ticket ${isResolved(ticket) ? 'resolved' : ''}`}
            >
              <div>
                <strong>
                  #{String(ticket.id).padStart(6, '0')}{' '}
                  <span className={`status-badge ${String(ticket.estado || '').replaceAll(' ', '-')}`}>
                    {statusLabel(ticket.estado)}
                  </span>
                </strong>

                <h4>{ticket.titulo}</h4>

                <p>
                  {isResolved(ticket) ? 'Resuelto por' : 'Asignado a'}: {ticket.tecnico}
                </p>

                <small>
                  {isResolved(ticket) ? 'Resuelto el' : 'Actualizado'}: {ticket.fecha} {ticket.hora}
                </small>
              </div>

              <div className="associate-ticket-category">
                {ticket.categoria}
              </div>

              <button
                type="button"
                onClick={() => isResolved(ticket) ? onOpenResolved(ticket) : onOpenTicket(ticket.id)}
              >
                {isResolved(ticket) ? 'Calificar' : 'Ver detalles'}
              </button>
            </div>
          ))}

          <div className="table-footer">
            <span>
              {tickets.length ? `Mostrando 1 a ${myTickets.length} de ${tickets.length} tickets` : 'No hay tickets registrados'}
            </span>

            <div>
              <button type="button">‹</button>
              <button type="button" className="active">1</button>
              <button type="button">›</button>
            </div>
          </div>
        </div>
      </section>

      <aside className="associate-right">
        <div className="panel quick-tips">
          <h3>Consejos rápidos</h3>
          <p>ⓘ Revisa el estado de tus tickets</p>
          <p>▣ Califica cuando tu ticket haya sido resuelto</p>
          <p>⌂ Consulta la base de conocimiento</p>
          <button type="button" className="link-btn">Ir a Wiki-TI →</button>
        </div>
      </aside>
    </div>
  );
}

export default AssociateDashboard;