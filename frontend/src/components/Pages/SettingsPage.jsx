import PageHeader from './PageHeader';

function SettingsPage() {
  return (
    <section className="module-page">
      <PageHeader title="Configuración" subtitle="Parámetros generales del HelpDesk_X." />
      <div className="settings-list">
        <label><span>Asignación automática Round Robin</span><input type="checkbox" defaultChecked /></label>
        <label><span>Notificaciones críticas invasivas</span><input type="checkbox" defaultChecked /></label>
        <label><span>Bloqueo por evaluación pendiente</span><input type="checkbox" defaultChecked /></label>
        <label><span>Sonidos de alerta</span><input type="checkbox" /></label>
      </div>
    </section>
  );
}

export default SettingsPage;
