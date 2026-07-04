import { useEffect, useState } from 'react';
import axios from 'axios';
import PageHeader from './PageHeader';
import { AUDIT_API_URL } from '../../config/api';

function AuditLogPage({ authToken }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    axios.get(AUDIT_API_URL, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setRows(response.data))
      .catch(() => setRows([]));
  }, [authToken]);
  return (
    <section className="module-page">
      <PageHeader title="Bitácora del Sistema" subtitle="Eventos de auditoría y actividad operativa." />
      <div className="timeline-list">
        {rows.map((row, index) => <div key={`${row.timestamp}-${index}`}><b>{String(index + 1).padStart(2, '0')}</b><span>{row.event}</span><small>{new Date(row.timestamp).toLocaleString('es-GT')}</small></div>)}
        {!rows.length && <div><span>Sin eventos de auditoría registrados.</span></div>}
      </div>
    </section>
  );
}

export default AuditLogPage;
