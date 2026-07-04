import { useEffect, useState } from "react";
import axios from "axios";
import PageHeader from "./PageHeader";
import { REPORTS_API_URL } from "../../config/api";

function ReportsPage({ authToken }) {
  const [data, setData] = useState({
    summary: {},
    categories: [],
    heatmap: [],
    utilization: [],
  });
  const headers = { Authorization: `Bearer ${authToken}` };
  useEffect(() => {
    axios
      .get(REPORTS_API_URL, { headers })
      .then((r) => setData(r.data))
      .catch(() => {});
  }, [authToken]); // eslint-disable-line react-hooks/exhaustive-deps
  const pdf = async () => {
    const r = await axios.get(
      `${REPORTS_API_URL}/performance.pdf`,
      { headers, responseType: "blob" },
    );
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reporte-helpdesk.pdf";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="module-page">
      <PageHeader
        title="Reportes"
        subtitle="Métricas reales de productividad y SLA."
        actionLabel="Exportar PDF"
        onAction={pdf}
      />
      <div className="report-grid">
        <article>
          <span>Total</span>
          <b>{data.summary.total || 0}</b>
        </article>
        <article>
          <span>Dentro de SLA</span>
          <b>{data.summary.dentro_sla || 0}</b>
        </article>
        <article>
          <span>Tiempo neto promedio</span>
          <b>
            {Math.round((data.summary.promedio_neto_segundos || 0) / 60)} min
          </b>
        </article>
      </div>
      <div className="panel heatmap-panel">
        <h3>Mapa de calor operacional</h3>
        <div className="heatmap-grid">
          {Array.from({ length: 168 }, (_, i) => {
            const d = Math.floor(i / 24) + 1,
              h = i % 24,
              v =
                data.heatmap.find((x) => x.dia === d && x.hora === h)?.total ||
                0;
            return (
              <span
                key={i}
                title={`Día ${d}, ${h}:00 · ${v}`}
                style={{ opacity: 0.18 + Math.min(v, 5) * 0.16 }}
              />
            );
          })}
        </div>
      </div>
      <div className="panel utilization-panel">
        <h3>Utilización de jornada</h3>
        <div className="cards-collection">
          {(data.utilization || []).map((technician) => {
            const percent = technician.segundos_registrados
              ? Math.round(
                  (technician.segundos_productivos /
                    technician.segundos_registrados) *
                    100,
                )
              : 0;
            return (
              <article className="person-card" key={technician.tecnico_id}>
                <div>
                  <h3>{technician.nombre}</h3>
                  <p>
                    {Math.round(technician.segundos_productivos / 60)} min
                    productivos
                  </p>
                </div>
                <strong>{percent}%</strong>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default ReportsPage;
