import { priorityLabel } from '../../data/helpdeskData';
import TicketQueue from './TicketQueue';
import TicketDetail from './TicketDetail';

function TicketWorkspace({ tickets, metrics, selectedTicket, selectedId, setSelectedId, authToken }) {
  if (!selectedTicket) return <div className="panel empty-state-card"><strong>No hay tickets registrados.</strong></div>;
  return (
    <section className="workspace-grid">
      <TicketQueue tickets={tickets} metrics={metrics} selectedId={selectedId} setSelectedId={setSelectedId} />
      <TicketDetail selectedTicket={selectedTicket} authToken={authToken} />
      <div className="side-actions">
        <div className="panel action-panel">
          <h3>Supervisión</h3>
          <p>La atención, pausa y resolución corresponden exclusivamente al técnico asignado.</p>
        </div>
        <div className="panel info-panel">
          <h3>Información</h3>
          <p><span>Prioridad</span><b className="red-text">{priorityLabel(selectedTicket.prioridad)} ›</b></p>
          <p><span>Estado</span><b className="yellow-text">En Proceso ›</b></p>
          <p><span>Asignado a</span><b>{selectedTicket.tecnico}</b></p>
          <p><span>Creado por</span><b>{selectedTicket.solicitante}</b></p>
        </div>
      </div>
    </section>
  );
}

export default TicketWorkspace;
