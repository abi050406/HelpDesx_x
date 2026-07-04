import { Metric } from '../Shared';

function MetricsGrid({ metrics, loading }) {
  return (
    <section className="kpi-grid admin-kpis">
      <Metric icon="▤" title="Total Tickets" value={loading ? '...' : metrics.total} trend="Datos actuales" tone="blue" />
      <Metric icon="✓" title="Resueltos" value={metrics.resueltos ?? 0} trend="Datos actuales" tone="green" />
      <Metric icon="◷" title="En Progreso" value={metrics.enProceso ?? 0} trend="Datos actuales" tone="orange" />
      <Metric icon="⌛" title="En Espera" value={metrics.enEspera ?? 0} trend="Datos actuales" tone="red" />
      <Metric icon="▣" title="Planificados" value={metrics.planificados ?? 0} trend="Datos actuales" tone="purple" />
    </section>
  );
}

export default MetricsGrid;
