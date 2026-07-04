import PageHeader from './PageHeader';

function CreateTicketPage({ onOpenModal }) {
  return (
    <section className="module-page">
      <PageHeader
        title="Crear Ticket"
        subtitle="Formulario guiado para clasificar y enviar tu solicitud al equipo de TI."
        actionLabel="+ Crear ticket"
        onAction={onOpenModal}
      />

      <div className="ticket-form-demo create-ticket-entry">
        <div>
          <span className="entry-eyebrow">Nuevo incidente</span>
          <h2>Cuéntanos qué está fallando</h2>
          <p>
            El sistema abrirá un formulario guiado con categoría, etiqueta,
            diagnóstico inicial y descripción del problema para que TI pueda atenderlo correctamente.
          </p>
        </div>

        <div className="entry-steps">
          <span>1 · Clasifica la categoría</span>
          <span>2 · Responde el diagnóstico</span>
          <span>3 · Envía al equipo TI</span>
        </div>

        <button type="button" onClick={onOpenModal}>
          Abrir formulario de ticket
        </button>
      </div>
    </section>
  );
}

export default CreateTicketPage;