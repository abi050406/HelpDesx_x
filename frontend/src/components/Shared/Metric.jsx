function Metric({ icon, title, value, trend, tone }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div>
        <span>{title}</span>
        <h2>{value}</h2>
        <small className={String(trend).includes('↓') ? 'down' : 'up'}>
          {trend}{String(trend).includes('Ver') ? '' : ' vs semana anterior'}
        </small>
      </div>
    </div>
  );
}

export default Metric;
