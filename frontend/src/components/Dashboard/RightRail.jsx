import { Notification, Technician } from '../Shared';

function RightRail({ tickets, technicianDirectory }) {
  const notifications = tickets.slice(0, 4).map((ticket) => ({
    type: ticket.estado.includes('resuelto') || ticket.estado.includes('cerrado') ? 'success' : ticket.prioridad.includes('crit') ? 'danger' : ticket.prioridad.includes('alta') ? 'warning' : 'info',
    title: ticket.estado.includes('resuelto') ? 'Ticket resuelto' : 'Actividad de ticket',
    text: `#${String(ticket.id).padStart(6, '0')} · ${ticket.titulo_tecnico || ticket.titulo}`,
    time: ticket.hora,
  }));
  const technicians = (technicianDirectory?.users || [])
    .filter((user) => user.role === 'tecnico')
    .map((user) => {
      const presence = technicianDirectory.presence?.find((item) => item.tecnico_id === user.id);
      const workload = tickets.filter((ticket) => Number(ticket.tecnico_id) === Number(user.id) && !ticket.estado.includes('resuelto') && !ticket.estado.includes('cerrado')).length;
      return { name: user.full_name, state: presence?.estado || 'Fuera de Servicio', tickets: workload };
    });
  return (
    <aside className="right-rail">
      <div className="panel notifications-panel">
        <h3>Notificaciones en Tiempo Real</h3>
        {notifications.map((item) => <Notification key={item.text} item={item} />)}
        {!notifications.length && <div className="empty-state-card"><strong>Sin actividad reciente.</strong></div>}
        <button className="link-btn">Ver todas las notificaciones →</button>
      </div>
      <div className="panel tech-panel">
        <h3>Estado de los técnicos</h3>
        {technicians.map((tech) => <Technician key={tech.name} tech={tech} />)}
        {!technicians.length && <div className="empty-state-card"><strong>No hay técnicos registrados.</strong></div>}
        <button className="link-btn">Ver todos los técnicos →</button>
      </div>
    </aside>
  );
}

export default RightRail;
