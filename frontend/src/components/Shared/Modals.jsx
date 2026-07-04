import { useState } from 'react';
import { calculateTicketPriority, ticketCategories } from '../../data/helpdeskData';

const MIN_TICKET_DESCRIPTION = 25;
const MIN_PERSIST_COMMENT = 25;
const MIN_RESOLUTION_EVIDENCE = 25;

function safeText(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function StarPicker({ value, onChange, disabled = false, label = 'Calificación' }) {
  return (
    <div className="rating-field">
      <span>{label}</span>
      <div className="stars interactive-stars" aria-label={label}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={star <= value ? 'selected' : ''}
            aria-label={`${star} estrellas`}
            onClick={() => onChange(star)}
            disabled={disabled}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

function ResolvedModal({ ticket, onFeedback, onPersist, onClose }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [mode, setMode] = useState('feedback');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cleanComment = comment.trim();
  const isFeedback = mode === 'feedback';

  const submit = async () => {
    setError('');

    if (isFeedback) {
      if (!rating) {
        setError('Selecciona una calificación para la atención recibida.');
        return;
      }

      if (!cleanComment) {
        setError('Agrega un comentario sobre el servicio recibido.');
        return;
      }
    } else if (cleanComment.length < MIN_PERSIST_COMMENT) {
      setError('Explique qué parte del problema continúa ocurriendo para que el técnico pueda retomarlo correctamente.');
      return;
    }

    setSaving(true);

    try {
      if (isFeedback) {
        await onFeedback({ score: rating, comment: cleanComment, resolved: true });
      } else {
        await onPersist({ comment: cleanComment, resolved: false });
      }

      if (onClose) onClose();
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          'No se pudo completar la acción. Actualiza los tickets e inténtalo nuevamente.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop strict-backdrop" role="dialog" aria-modal="true">
      <div className="resolved-modal ticket-feedback-modal">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">
          ×
        </button>

        <div className="checkmark">✓</div>
        <h2>¡Ticket Resuelto!</h2>
        <p className="feedback-subtitle">Por favor califica la atención recibida</p>

        <div className="resolved-ticket-context">
          <div className="context-main-row">
            <strong>Ticket #{String(ticket?.id || '').padStart(6, '0')}</strong>
            <span>{ticket?.categoria || 'Soporte'}</span>
          </div>

          <p className="context-description">
            “{ticket?.descripcion_breve || ticket?.descripcion || 'Sin descripción disponible.'}”
          </p>

          <small>
            Atendido por: <b>{ticket?.tecnico || 'Técnico asignado'}</b>
          </small>
        </div>

        <div className="feedback-choice-row" role="tablist" aria-label="Resultado del ticket">
          <button
            type="button"
            className={isFeedback ? 'active success' : ''}
            onClick={() => {
              setMode('feedback');
              setError('');
              setComment('');
            }}
            disabled={saving}
          >
            Todo está solucionado
          </button>

          <button
            type="button"
            className={!isFeedback ? 'active danger' : ''}
            onClick={() => {
              setMode('persist');
              setError('');
              setRating(0);
              setComment('');
            }}
            disabled={saving}
          >
            La falla persiste
          </button>
        </div>

        {isFeedback && (
          <div className="stars interactive-stars" aria-label="Calificación">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`${value} estrellas`}
                onClick={() => setRating(value)}
                className={value <= rating ? 'selected' : ''}
                disabled={saving}
              >
                ★
              </button>
            ))}
          </div>
        )}

        <label className="feedback-comment-block">
          <span>{isFeedback ? 'Comentario sobre el servicio' : 'Detalle de la falla persistente'}</span>
          <textarea
            placeholder={
              isFeedback
                ? 'Comente cómo fue la atención, el trato y la solución brindada.'
                : 'Explique qué parte del problema continúa ocurriendo para que el técnico pueda retomarlo correctamente.'
            }
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={saving}
          />
        </label>

        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions feedback-actions">
          <button className={isFeedback ? 'green' : 'red'} disabled={saving} onClick={submit}>
            {saving ? 'Guardando...' : isFeedback ? 'Confirmar solución' : 'Reportar falla persistente'}
          </button>

          <button className="secondary-action" type="button" onClick={onClose} disabled={saving}>
            Cerrar
          </button>
        </div>

        <small>Debes completar esta validación para continuar usando el sistema.</small>
      </div>
    </div>
  );
}

function TechnicianResolveModal({ ticket, onResolveSubmit, onClose }) {
  const [evidence, setEvidence] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cleanEvidence = safeText(evidence);
  const cleanComment = safeText(comment);
  const isValid = cleanEvidence.length >= MIN_RESOLUTION_EVIDENCE && rating > 0 && Boolean(cleanComment);

  const submit = async () => {
    setError('');

    if (cleanEvidence.length < MIN_RESOLUTION_EVIDENCE) {
      setError('Agregue más detalle sobre la solución aplicada antes de marcar el ticket como resuelto.');
      return;
    }

    if (rating === 0) {
      setError('Es obligatorio calificar al asociado para cerrar el ticket.');
      return;
    }

    if (!cleanComment) {
      setError('Comente si el asociado brindó información clara, respondió a tiempo o colaboró durante la atención.');
      return;
    }

    setSaving(true);

    try {
      await onResolveSubmit({
        evidencia_resolucion: cleanEvidence,
        evidence: cleanEvidence,
        associateStars: rating,
        associateComment: cleanComment,
        asociado_rating: rating,
        asociado_comentario: cleanComment,
      });

      if (onClose) onClose();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo registrar la resolución.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop strict-backdrop" role="dialog" aria-modal="true">
      <div className="resolved-modal technician-resolve-modal">
        <h2>Resolver Ticket #{String(ticket?.id || '').padStart(6, '0')}</h2>

        <p className="modal-subtitle">
          {ticket?.titulo_tecnico || `${ticket?.solicitante || 'Asociado'} / ${ticket?.categoria || 'Categoría'}`}
        </p>

        <div className="problem-preview">
          <span>Problema reportado:</span>
          <p>“{ticket?.descripcion_breve || ticket?.descripcion || 'Sin descripción disponible.'}”</p>
        </div>

        <label className="modal-field">
          <span>Evidencia técnica de resolución</span>
          <textarea
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            placeholder="Explique brevemente qué acción técnica realizó para resolver el caso."
            disabled={saving}
          />
          <small className={cleanEvidence.length >= MIN_RESOLUTION_EVIDENCE ? 'field-ok' : 'field-hint'}>
            {cleanEvidence.length >= MIN_RESOLUTION_EVIDENCE
              ? '✓ Evidencia suficiente'
              : 'Agregue más detalle sobre la solución aplicada.'}
          </small>
        </label>

        <StarPicker value={rating} onChange={setRating} disabled={saving} label="Califica la colaboración del asociado" />

        <label className="modal-field">
          <span>Comentario sobre el asociado</span>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Comente si el asociado brindó información clara, respondió a tiempo o colaboró durante la atención."
            disabled={saving}
          />
          <small className={cleanComment ? 'field-ok' : 'field-hint'}>
            {cleanComment ? '✓ Comentario agregado' : 'Agregue un comentario sobre la colaboración del asociado.'}
          </small>
        </label>

        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button className="green" onClick={submit} disabled={saving || !isValid}>
            {saving ? 'Procesando...' : 'Marcar como resuelto'}
          </button>

          <button className="red" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateTicketModal({
  onClose,
  setToast,
  onCreateTicket,
  currentUser,
  catalog,
  existingTickets = [],
}) {
  const getInitialCategory = () => {
    if (Array.isArray(catalog) && catalog.length) {
      return catalog[0]?.nombre_categoria || catalog[0]?.categoria || 'Software';
    }

    if (catalog && !Array.isArray(catalog)) {
      return Object.keys(catalog)[0] || 'Software';
    }

    return ticketCategories.Software ? 'Software' : Object.keys(ticketCategories)[0];
  };

  const [form, setForm] = useState({
    categoria: getInitialCategory(),
    etiqueta: '',
    etiqueta_id: null,
    respuestas: {},
    descripcion: '',
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const associateName = currentUser?.name || currentUser?.full_name || currentUser?.username || 'Asociado';
  const isAssociate = String(currentUser?.role || '').toLowerCase() === 'associate';

  const categories = Array.isArray(catalog) && catalog.length
    ? catalog.map((item) => item.nombre_categoria || item.categoria).filter(Boolean)
    : catalog && !Array.isArray(catalog)
      ? Object.keys(catalog)
      : Object.keys(ticketCategories);

  const catalogItem = Array.isArray(catalog)
    ? catalog.find((item) => (item.nombre_categoria || item.categoria) === form.categoria)
    : null;

  const rawConfig = catalogItem
    ? {
        slaMinutes: catalogItem.tiempo_sla_minutos || catalogItem.slaMinutes || catalogItem.sla_objetivo_minutos,
        tags: catalogItem.etiquetas || catalogItem.tags || catalogItem.labels || [],
        questions: catalogItem.preguntas_contexto || catalogItem.questions || [],
      }
    : catalog && !Array.isArray(catalog) && catalog[form.categoria]
      ? catalog[form.categoria]
      : ticketCategories[form.categoria] || ticketCategories.Software || { questions: [], tags: [] };

  const normalizeTag = (tag) => {
    if (typeof tag === 'string') return { id: null, label: tag };

    return {
      id: tag?.id || tag?.etiqueta_id || tag?.tag_id || null,
      label: tag?.nombre || tag?.name || tag?.etiqueta || tag?.label || '',
    };
  };

  const normalizeQuestion = (question) => {
    const options = question.options || question.opciones || [];

    return {
      ...question,
      id: question.id || question.key || question.nombre || question.label,
      label: question.label || question.pregunta || question.nombre || 'Pregunta de contexto',
      options: options.map((option) => {
        if (Array.isArray(option)) return option;

        return [
          option.label || option.nombre || option.text || String(option.score || option.value || ''),
          option.score ?? option.value ?? option.puntaje ?? 0,
        ];
      }),
    };
  };

  const availableTags = (rawConfig.tags || rawConfig.etiquetas || rawConfig.labels || [])
    .map(normalizeTag)
    .filter((tag) => tag.label);

  const questions = (rawConfig.questions || rawConfig.preguntas_contexto || []).map(normalizeQuestion);
  const slaMinutes = rawConfig.slaMinutes || rawConfig.tiempo_sla_minutos || rawConfig.sla_objetivo_minutos || '—';

  const cleanDescription = form.descripcion.trim();
  const descriptionNeedsMoreDetail = cleanDescription.length > 0 && cleanDescription.length < MIN_TICKET_DESCRIPTION;
  const associateTitle = form.categoria || 'Solicitud de soporte';
  const technicianTitle = `${associateName} / ${form.categoria || 'Soporte'}`;

  const priorityResult = calculateTicketPriority(form.categoria, form.respuestas);

  const plannedSameCategoryTicket = existingTickets.find((ticket) => {
    const state = normalizeText(ticket.estado);
    const ticketCategory = normalizeText(ticket.categoria);
    const selectedCategory = normalizeText(form.categoria);

    return state.includes('plan') && ticketCategory === selectedCategory;
  });

  const plannedSameCategoryBlocked = Boolean(plannedSameCategoryTicket);

  const update = (field, value) => {
    setError('');

    setForm((prev) =>
      field === 'categoria'
        ? {
            categoria: value,
            etiqueta: '',
            etiqueta_id: null,
            respuestas: {},
            descripcion: prev.descripcion,
          }
        : {
            ...prev,
            [field]: value,
          }
    );
  };

  const updateTag = (value) => {
    const selected = availableTags.find((tag) => tag.label === value);
    setError('');

    setForm((prev) => ({
      ...prev,
      etiqueta: value,
      etiqueta_id: selected?.id || null,
    }));
  };

  const updateAnswer = (questionId, value) => {
    setError('');

    setForm((prev) => ({
      ...prev,
      respuestas: {
        ...prev.respuestas,
        [questionId]: value === '' ? '' : Number(value),
      },
    }));
  };

  const missingQuestions = questions.some(
    (question) => form.respuestas[question.id] === undefined || form.respuestas[question.id] === ''
  );

  const missingTag = availableTags.length > 0 && !form.etiqueta;

  const canCreate =
    Boolean(form.categoria) &&
    !plannedSameCategoryBlocked &&
    !missingTag &&
    !missingQuestions &&
    cleanDescription.length >= MIN_TICKET_DESCRIPTION &&
    !saving;

  const create = async () => {
    setError('');

    if (plannedSameCategoryBlocked) {
      setError(`Ya tienes un ticket de ${form.categoria} planificado. No es necesario crear otro para el mismo problema.`);
      return;
    }

    if (!form.categoria) {
      setError('Seleccione una categoría para clasificar la solicitud.');
      return;
    }

    if (missingTag) {
      setError('Seleccione una etiqueta para clasificar mejor el incidente.');
      return;
    }

    if (missingQuestions) {
      setError('Responda las preguntas de diagnóstico para calcular correctamente el impacto.');
      return;
    }

    if (cleanDescription.length < MIN_TICKET_DESCRIPTION) {
      setError('Explique con más detalle su problema para que TI pueda ayudarle mejor.');
      return;
    }

    setSaving(true);

    try {
      await onCreateTicket({
        categoria: form.categoria,
        etiqueta_id: form.etiqueta_id,
        etiqueta: form.etiqueta,
        descripcion: cleanDescription,
        respuestas: form.respuestas,
        titulo: associateTitle,
        titulo_tecnico: technicianTitle,
        priorityPreview: priorityResult.priority,
        puntaje_prioridad: priorityResult.score,
      });

      onClose?.();
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          'No se pudo crear el ticket. Revise los datos e inténtelo nuevamente.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="resolved-modal create-modal create-modal-restored">
        <button className="modal-close" type="button" onClick={onClose}>
          ×
        </button>

        <h2>Crear Ticket</h2>
        <p>Selecciona la categoría y describe tu solicitud de soporte técnico.</p>

        <div className="auto-ticket-title">
          <span>Título automático</span>
          <strong>{associateTitle}</strong>
          <small>Vista técnica: {technicianTitle}</small>
        </div>

        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}

        {plannedSameCategoryBlocked && (
          <p className="modal-error" role="alert">
            Ya tienes un ticket de {form.categoria} planificado. No es necesario crear otro para el mismo problema.
          </p>
        )}

        <div className="modal-form-grid">
          <label className="modal-field">
            <span>Categoría del problema</span>
            <select value={form.categoria} onChange={(event) => update('categoria', event.target.value)} disabled={saving}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="modal-field">
            <span>Etiqueta</span>
            <select value={form.etiqueta} onChange={(event) => updateTag(event.target.value)} disabled={saving || !availableTags.length}>
              <option value="">Selecciona una etiqueta</option>
              {availableTags.map((tag) => (
                <option key={tag.label} value={tag.label}>
                  {tag.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="diagnostic-questions">
          <div className="diagnostic-head">
            <div>
              <strong>Diagnóstico inicial</strong>
              <small>SLA objetivo: {slaMinutes} minutos</small>
            </div>

            {!isAssociate && (
              <span
                className={`priority-preview ${String(priorityResult.priority || '')
                  .toLowerCase()
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')}`}
              >
                {priorityResult.priority} · {priorityResult.score} pts
              </span>
            )}
          </div>

          {questions.map((question) => (
            <label className="modal-field" key={question.id}>
              <span>{question.label}</span>
              <select value={form.respuestas[question.id] ?? ''} onChange={(event) => updateAnswer(question.id, event.target.value)} disabled={saving}>
                <option value="">Selecciona una respuesta</option>
                {question.options.map(([label, score]) => (
                  <option key={label} value={score}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <label className="modal-field description-field-restored">
          <span>Descripción detallada</span>
          <textarea
            placeholder="Agregue más detalles sobre lo que ocurre, desde cuándo sucede o qué mensaje de error aparece."
            value={form.descripcion}
            onChange={(event) => update('descripcion', event.target.value)}
            disabled={saving}
          />

          {descriptionNeedsMoreDetail && (
            <small className="create-ticket-help-text">
              Explique con más detalle su problema para que TI pueda ayudarle mejor.
            </small>
          )}
        </label>

        <div className="modal-actions">
          <button className="green" onClick={create} disabled={!canCreate}>
            {saving ? 'Creando...' : 'Crear Ticket'}
          </button>

          <button className="red" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function PresenceReasonModal({ status, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const required = status === 'Fuera de Servicio';

  return (
    <div className="modal-backdrop strict-backdrop" role="dialog" aria-modal="true">
      <div className="resolved-modal">
        <h2>Cambiar a {status}</h2>
        <p>{required ? 'Registra la razón de tu ausencia.' : 'Puedes agregar una razón para registrar la pausa.'}</p>

        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={required ? 'Razón obligatoria...' : 'Razón opcional...'}
        />

        <div className="modal-actions">
          <button className="green" disabled={required && !reason.trim()} onClick={() => onConfirm(reason)}>
            Confirmar
          </button>

          <button className="red" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function CriticalAlert({ ticket, onStart }) {
  return (
    <div className="critical-overlay" role="alertdialog" aria-modal="true">
      <div>
        <span>🚨 INCIDENTE CRÍTICO</span>
        <h1>#{ticket?.id} · {ticket?.titulo_tecnico || ticket?.titulo}</h1>
        <p>{ticket?.descripcion}</p>
        <button type="button" onClick={onStart}>
          Iniciar atención ahora
        </button>
      </div>
    </div>
  );
}

export { ResolvedModal, CreateTicketModal, TechnicianResolveModal, PresenceReasonModal, CriticalAlert };