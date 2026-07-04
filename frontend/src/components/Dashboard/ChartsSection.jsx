function ChartsSection({ metrics, categoryData, tickets, technicianDirectory }) {
  const categoryTotal = Object.values(categoryData).reduce((acc, value) => acc + value, 0) || 1;
  const performance = (technicianDirectory?.users || []).filter((user) => user.role === 'tecnico').map((technician) => ({
    id: technician.id,
    name: technician.full_name,
    total: tickets.filter((ticket) => Number(ticket.tecnico_id) === Number(technician.id) && (ticket.estado.includes('resuelto') || ticket.estado.includes('cerrado'))).length,
  }));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    const daily = tickets.filter((ticket) => String(ticket.created_at || '').slice(0, 10) === key && ticket.duracion_neta_segundos > 0);
    return { key, label: date.toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit' }), minutes: daily.length ? Math.round(daily.reduce((sum, ticket) => sum + ticket.duracion_neta_segundos, 0) / daily.length / 60) : 0 };
  });
  const measured = tickets.filter((ticket) => ticket.duracion_neta_segundos > 0);
  const averageMinutes = Math.round(measured.reduce((sum, ticket) => sum + ticket.duracion_neta_segundos, 0) / Math.max(1, measured.length) / 60);

  return (
    <section className="charts-grid">
      <div className="panel category-panel">
        <h3>Tickets por Categoría</h3>
        <div className="donut-wrap">
          <div className="donut"><strong>{metrics.total ?? 0}</strong><span>Total</span></div>
          <div className="legend-list">
            {Object.entries(categoryData).map(([name, value], index) => (
              <div key={name}>
                <i className={`dot dot-${index}`} />
                <span>{name}</span>
                <b>{Math.round((value / categoryTotal) * 100)}% ({value})</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      <BarsPanel performance={performance} />
      <LinePanel days={days} value={`${averageMinutes} min`} />
    </section>
  );
}

function BarsPanel({ performance }) {
  const max = Math.max(1, ...performance.map((item) => item.total));
  return (
    <div className="panel bars-panel">
      <div className="panel-head"><h3>Resueltos por técnico</h3></div>
      <div className="bar-chart">
        {performance.map((item) => (
          <div className="bar-col" key={item.id}>
            <span>{item.total}</span>
            <div style={{ height: `${Math.max(4, (item.total / max) * 100)}%` }} />
            <small>{item.name}</small>
          </div>
        ))}
        {!performance.length && <p className="chart-empty">Sin técnicos registrados</p>}
      </div>
    </div>
  );
}

function LinePanel({ days, value }) {
  const max = Math.max(1, ...days.map((day) => day.minutes));
  const points = days.map((day, index) => `${index * 70},${135 - (day.minutes / max) * 100}`).join(' ');
  return (
    <div className="panel line-panel">
      <div className="panel-head"><h3>Tiempo neto promedio</h3></div>
      <h2>{value}</h2>
      <p>Últimos siete días</p>
      <div className="line-chart">
        <svg viewBox="0 0 420 160" preserveAspectRatio="none">
          <polyline points={points} />
        </svg>
        <div className="x-axis">{days.map((day) => <span key={day.key}>{day.label}</span>)}</div>
      </div>
    </div>
  );
}

export default ChartsSection;
