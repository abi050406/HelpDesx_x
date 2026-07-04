import PageHeader from './PageHeader';

function NewsPage() {
  return (
    <section className="module-page">
      <PageHeader title="Noticias y Avisos" subtitle="Comunicados del departamento de TI para asociados." />
      <div className="wiki-grid"><article className="wiki-card"><span>Aviso</span><h3>Mantenimiento programado</h3><p>Viernes 7:00 PM - 9:00 PM</p></article><article className="wiki-card"><span>Seguridad</span><h3>Actualización de contraseñas</h3><p>Recuerda no compartir credenciales.</p></article></div>
    </section>
  );
}

export default NewsPage;
