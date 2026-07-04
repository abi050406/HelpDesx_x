function Technician({ tech }) {
  const stateClass = tech.state.toLowerCase().replaceAll(' ', '-');
  const online = tech.state !== 'Fuera de Servicio';
  return (
    <div className="tech-row">
      <div className="mini-avatar">👨</div>
      <div><strong>{tech.name}</strong><span className={stateClass}>{tech.state}</span></div>
      <small className={online ? 'online' : 'offline'}>{online ? '● En línea' : '○ Offline'} · {tech.tickets} tickets</small>
    </div>
  );
}

export default Technician;
