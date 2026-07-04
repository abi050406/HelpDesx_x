import { menuByRole } from '../../data/helpdeskData';

function Sidebar({ role, activePanel, onNavigate, sidebarCollapsed, setSidebarCollapsed, tickets = [] }) {
  const isAssociate = role === 'associate';
  const baseMenu = menuByRole[role] || [];
  const menu = role === 'admin' && !baseMenu.some((item) => item.id === 'ratings')
    ? [...baseMenu, { id: 'ratings', icon: '★', label: 'Calificaciones' }]
    : baseMenu;
  const badgeFor = (item) => {
    const active = tickets.filter((ticket) => !String(ticket.estado || '').toLowerCase().includes('resuelto') && !String(ticket.estado || '').toLowerCase().includes('cerrado'));
    if (role === 'admin' && item.id === 'tickets') return tickets.length;
    if (role === 'associate' && item.id === 'myTickets') return tickets.length;
    if (role === 'tech' && item.id === 'myTickets') return tickets.length;
    if (role === 'tech' && item.id === 'assignedTickets') return active.length;
    if (role === 'tech' && item.id === 'waiting') return active.filter((ticket) => String(ticket.estado || '').toLowerCase().includes('espera')).length;
    if (role === 'tech' && item.id === 'planned') return active.filter((ticket) => String(ticket.estado || '').toLowerCase().includes('plan')).length;
    return null;
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">🎧</div>
        <div className="brand-copy">
          <h2>HelpDesk_X</h2>
          <span>Soporte Técnico Interno</span>
        </div>
      </div>

      <button className="collapse-btn" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
        {sidebarCollapsed ? '→' : '←'}
      </button>

      <nav className="sidebar-menu">
        {menu.map((item) => {
          const badge = badgeFor(item);
          return (
          <button
            key={item.id}
            className={`menu-item ${activePanel === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="menu-icon">{item.icon}</span>
            <span className="menu-label">{item.label}</span>
            {badge ? <span className="menu-badge">{badge}</span> : null}
          </button>
          );
        })}
      </nav>

      {role === 'tech' ? (
        <div className="system-card status-card">
          <strong>Mi Estado</strong>
          <button className="status-option active">● Activo</button>
          <button className="status-option break">● En Break</button>
          <button className="status-option off">● Fuera de Servicio</button>
          <div><small>Presencia</small><small>Sincronizada</small></div>
          <div><small>Heartbeat</small><small>Cada 30 s</small></div>
        </div>
      ) : isAssociate ? (
        <div className="help-card">
          <b>¿Necesitas ayuda?</b>
          <p>Consulta nuestra base de conocimiento.</p>
          <button onClick={() => onNavigate('wiki')}>Ir a Wiki-TI</button>
        </div>
      ) : (
        <div className="system-card">
          <div><strong>Estado del Sistema</strong><span>En línea</span></div>
          <div><small>Hora del Servidor</small><small>10:24:35 (CST)</small></div>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;
