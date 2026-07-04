import { useEffect, useMemo, useState } from 'react';
import PageHeader from './PageHeader';
import { ADMIN_API_URL as ADMIN_API } from '../../config/api';

function getAuthHeaders() {
  const token =
    localStorage.getItem('helpdesk_x_token') ||
    sessionStorage.getItem('helpdesk_x_token') ||
    localStorage.getItem('token') ||
    sessionStorage.getItem('token') ||
    '';

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePriorityClass(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);

  const [categoryForm, setCategoryForm] = useState({
    nombre_categoria: '',
    descripcion: '',
    tiempo_sla_minutos: 60,
    color: '#2563eb',
    icono: 'tag',
  });

  const [tagForm, setTagForm] = useState({
    nombre: '',
    descripcion: '',
  });

  const [questionForm, setQuestionForm] = useState({
    pregunta: '',
    is_required: true,
  });

  const [optionForm, setOptionForm] = useState({
    pregunta_id: '',
    texto: '',
    puntaje: 0,
  });

  const selectedCategory = useMemo(() => {
    return categories.find((cat) => Number(cat.id) === Number(selectedId)) || categories[0] || null;
  }, [categories, selectedId]);

  const activeCategories = categories.filter((cat) => cat.is_active).length;
  const totalTags = categories.reduce((sum, cat) => sum + safeArray(cat.etiquetas).length, 0);
  const totalQuestions = categories.reduce(
    (sum, cat) => sum + safeArray(cat.preguntas || cat.preguntas_contexto).length,
    0
  );

  const loadCategories = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${ADMIN_API}/categories`, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudieron cargar las categorías.');
      }

      const rows = Array.isArray(data) ? data : data.categories || [];
      setCategories(rows);

      if (!selectedId && rows.length) {
        setSelectedId(rows[0].id);
      }
    } catch (requestError) {
      setError(requestError.message || 'Error cargando categorías.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showSuccess = (text) => {
    setMessage(text);
    setError('');
    setTimeout(() => setMessage(''), 3000);
  };

  const handleCreateCategory = async () => {
    setError('');
    setMessage('');

    if (!categoryForm.nombre_categoria.trim()) {
      setError('El nombre de la categoría es obligatorio.');
      return;
    }

    if (Number(categoryForm.tiempo_sla_minutos) <= 0) {
      setError('El SLA debe ser mayor a cero minutos.');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${ADMIN_API}/categories`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          nombre_categoria: categoryForm.nombre_categoria.trim(),
          descripcion: categoryForm.descripcion.trim(),
          tiempo_sla_minutos: Number(categoryForm.tiempo_sla_minutos),
          color: categoryForm.color,
          icono: categoryForm.icono.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo crear la categoría.');
      }

      setCategoryForm({
        nombre_categoria: '',
        descripcion: '',
        tiempo_sla_minutos: 60,
        color: '#2563eb',
        icono: 'tag',
      });

      setShowNewCategory(false);
      await loadCategories();
      showSuccess('Categoría creada correctamente.');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear la categoría.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCategory = async (categoryId, patch) => {
    setSaving(true);
    setError('');

    const current = categories.find((cat) => Number(cat.id) === Number(categoryId));

    try {
      const response = await fetch(`${ADMIN_API}/categories/${categoryId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          nombre_categoria: current?.nombre_categoria,
          descripcion: current?.descripcion || '',
          tiempo_sla_minutos: Number(current?.tiempo_sla_minutos || 60),
          color: current?.color || '',
          icono: current?.icono || '',
          ...patch,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo actualizar la categoría.');
      }

      await loadCategories();
      showSuccess('Categoría actualizada.');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la categoría.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCategory = async (categoryId) => {
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${ADMIN_API}/categories/${categoryId}/toggle`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo cambiar el estado de la categoría.');
      }

      await loadCategories();
      showSuccess('Estado de categoría actualizado.');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo cambiar el estado.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddTag = async () => {
    if (!selectedCategory) return;

    setError('');

    if (!tagForm.nombre.trim()) {
      setError('El nombre de la etiqueta es obligatorio.');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${ADMIN_API}/categories/${selectedCategory.id}/tags`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          nombre: tagForm.nombre.trim(),
          descripcion: tagForm.descripcion.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo crear la etiqueta.');
      }

      setTagForm({ nombre: '', descripcion: '' });
      await loadCategories();
      showSuccess('Etiqueta agregada.');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear la etiqueta.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleTag = async (tag) => {
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${ADMIN_API}/tags/${tag.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          nombre: tag.nombre,
          descripcion: tag.descripcion || '',
          is_active: !tag.is_active,
          sort_order: tag.sort_order || 0,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo actualizar la etiqueta.');
      }

      await loadCategories();
      showSuccess('Etiqueta actualizada.');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la etiqueta.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuestion = async () => {
    if (!selectedCategory) return;

    setError('');

    if (!questionForm.pregunta.trim()) {
      setError('La pregunta es obligatoria.');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${ADMIN_API}/categories/${selectedCategory.id}/questions`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          pregunta: questionForm.pregunta.trim(),
          is_required: Boolean(questionForm.is_required),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo crear la pregunta.');
      }

      setQuestionForm({ pregunta: '', is_required: true });
      await loadCategories();
      showSuccess('Pregunta agregada.');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear la pregunta.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleQuestion = async (question) => {
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${ADMIN_API}/questions/${question.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          pregunta: question.pregunta,
          is_required: question.is_required,
          is_active: !question.is_active,
          sort_order: question.sort_order || 0,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo actualizar la pregunta.');
      }

      await loadCategories();
      showSuccess('Pregunta actualizada.');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la pregunta.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddOption = async () => {
    setError('');

    if (!optionForm.pregunta_id) {
      setError('Seleccione una pregunta para agregar la opción.');
      return;
    }

    if (!optionForm.texto.trim()) {
      setError('El texto de la opción es obligatorio.');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${ADMIN_API}/questions/${optionForm.pregunta_id}/options`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          texto: optionForm.texto.trim(),
          nombre: optionForm.texto.trim(),
          puntaje: Number(optionForm.puntaje),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo crear la opción.');
      }

      setOptionForm({
        pregunta_id: optionForm.pregunta_id,
        texto: '',
        puntaje: 0,
      });

      await loadCategories();
      showSuccess('Opción agregada.');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo crear la opción.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleOption = async (option) => {
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${ADMIN_API}/question-options/${option.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          texto: option.texto || option.nombre,
          nombre: option.nombre || option.texto,
          puntaje: Number(option.puntaje || 0),
          is_active: !option.is_active,
          sort_order: option.sort_order || 0,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo actualizar la opción.');
      }

      await loadCategories();
      showSuccess('Opción actualizada.');
    } catch (requestError) {
      setError(requestError.message || 'No se pudo actualizar la opción.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="module-page admin-categories-page">
      <PageHeader
        title="Categorías"
        subtitle="Clasificación operativa de tickets, SLA, etiquetas y preguntas de diagnóstico."
        actionLabel={showNewCategory ? 'Cerrar formulario' : '+ Nueva categoría'}
        onAction={() => setShowNewCategory((current) => !current)}
      />

      <div className="admin-categories-summary">
        <div className="admin-summary-card">
          <span>Total categorías</span>
          <strong>{categories.length}</strong>
          <small>Configuradas en base de datos</small>
        </div>
        <div className="admin-summary-card">
          <span>Activas</span>
          <strong>{activeCategories}</strong>
          <small>Disponibles para tickets</small>
        </div>
        <div className="admin-summary-card">
          <span>Etiquetas</span>
          <strong>{totalTags}</strong>
          <small>Opciones de clasificación</small>
        </div>
        <div className="admin-summary-card">
          <span>Preguntas</span>
          <strong>{totalQuestions}</strong>
          <small>Diagnóstico y prioridad</small>
        </div>
      </div>

      {message && <div className="admin-inline-success">✓ {message}</div>}
      {error && <div className="admin-inline-error">⚠ {error}</div>}

      {showNewCategory && (
        <div className="panel admin-config-panel admin-create-category-card">
          <div className="panel-head">
            <div>
              <h3>Nueva categoría</h3>
              <p>Define una categoría nueva para clasificar tickets y calcular SLA.</p>
            </div>
          </div>

          <div className="admin-form-grid">
            <label>
              <span>Nombre</span>
              <input
                value={categoryForm.nombre_categoria}
                onChange={(event) => setCategoryForm((prev) => ({ ...prev, nombre_categoria: event.target.value }))}
                placeholder="Ej. Telefonía"
              />
            </label>

            <label>
              <span>SLA minutos</span>
              <input
                type="number"
                min="1"
                value={categoryForm.tiempo_sla_minutos}
                onChange={(event) => setCategoryForm((prev) => ({ ...prev, tiempo_sla_minutos: event.target.value }))}
              />
            </label>

            <label>
              <span>Color</span>
              <input
                type="color"
                value={categoryForm.color}
                onChange={(event) => setCategoryForm((prev) => ({ ...prev, color: event.target.value }))}
              />
            </label>

            <label>
              <span>Icono</span>
              <input
                value={categoryForm.icono}
                onChange={(event) => setCategoryForm((prev) => ({ ...prev, icono: event.target.value }))}
                placeholder="Ej. phone"
              />
            </label>

            <label className="admin-wide-field">
              <span>Descripción</span>
              <input
                value={categoryForm.descripcion}
                onChange={(event) => setCategoryForm((prev) => ({ ...prev, descripcion: event.target.value }))}
                placeholder="Describe cuándo usar esta categoría"
              />
            </label>
          </div>

          <div className="admin-actions-row">
            <button className="green admin-primary-btn" onClick={handleCreateCategory} disabled={saving}>
              {saving ? 'Guardando...' : 'Crear categoría'}
            </button>
            <button className="red admin-danger-btn" onClick={() => setShowNewCategory(false)} disabled={saving}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="admin-config-layout">
        <div className="panel admin-category-list">
          <div className="panel-head">
            <div>
              <h3>Categorías activas</h3>
              <p>{loading ? 'Cargando catálogo...' : `${categories.length} categorías configuradas`}</p>
            </div>
            <button className="admin-ghost-btn" onClick={loadCategories} disabled={loading || saving}>
              Refrescar
            </button>
          </div>

          <div className="admin-category-cards">
            {safeArray(categories).map((cat) => {
              const selected = Number(selectedCategory?.id) === Number(cat.id);

              return (
                <button
                  type="button"
                  className={`admin-category-card ${selected ? 'selected' : ''} ${cat.is_active ? '' : 'inactive'}`}
                  key={cat.id}
                  onClick={() => setSelectedId(cat.id)}
                >
                  <div className="admin-category-topline">
                    <span
                      className="admin-category-color"
                      style={{ background: cat.color || '#2563eb' }}
                    />
                    <strong>{cat.nombre_categoria}</strong>
                    <em>{cat.is_active ? 'Activa' : 'Inactiva'}</em>
                  </div>

                  <p>{cat.descripcion || 'Sin descripción configurada.'}</p>

                  <div className="admin-category-meta">
                    <span>SLA {cat.tiempo_sla_minutos} min</span>
                    <span>{safeArray(cat.etiquetas).length} etiquetas</span>
                    <span>{safeArray(cat.preguntas || cat.preguntas_contexto).length} preguntas</span>
                  </div>
                </button>
              );
            })}

            {!loading && !categories.length && (
              <div className="empty-state-card">
                <strong>No hay categorías configuradas.</strong>
                <p>Crea una categoría para iniciar.</p>
              </div>
            )}
          </div>
        </div>

        <div className="panel admin-category-detail">
          {!selectedCategory ? (
            <div className="empty-state-card">
              <strong>Selecciona una categoría.</strong>
              <p>Desde aquí podrás editar SLA, etiquetas, preguntas y opciones.</p>
            </div>
          ) : (
            <>
              <div className="admin-detail-hero">
                <div>
                  <span
                    className="admin-detail-color"
                    style={{ background: selectedCategory.color || '#2563eb' }}
                  />
                  <h3>{selectedCategory.nombre_categoria}</h3>
                  <p>{selectedCategory.descripcion || 'Sin descripción configurada.'}</p>
                </div>

                <button
                  className={selectedCategory.is_active ? 'admin-danger-btn' : 'admin-primary-btn'}
                  onClick={() => handleToggleCategory(selectedCategory.id)}
                  disabled={saving}
                >
                  {selectedCategory.is_active ? 'Desactivar' : 'Activar'}
                </button>
              </div>

              <div className="admin-form-grid compact-fields">
                <label>
                  <span>SLA minutos</span>
                  <input
                    type="number"
                    min="1"
                    value={selectedCategory.tiempo_sla_minutos || 60}
                    onChange={(event) =>
                      setCategories((prev) =>
                        prev.map((cat) =>
                          Number(cat.id) === Number(selectedCategory.id)
                            ? { ...cat, tiempo_sla_minutos: event.target.value }
                            : cat
                        )
                      )
                    }
                  />
                </label>

                <label>
                  <span>Color</span>
                  <input
                    type="color"
                    value={selectedCategory.color || '#2563eb'}
                    onChange={(event) =>
                      setCategories((prev) =>
                        prev.map((cat) =>
                          Number(cat.id) === Number(selectedCategory.id)
                            ? { ...cat, color: event.target.value }
                            : cat
                        )
                      )
                    }
                  />
                </label>

                <label>
                  <span>Icono</span>
                  <input
                    value={selectedCategory.icono || ''}
                    onChange={(event) =>
                      setCategories((prev) =>
                        prev.map((cat) =>
                          Number(cat.id) === Number(selectedCategory.id)
                            ? { ...cat, icono: event.target.value }
                            : cat
                        )
                      )
                    }
                  />
                </label>

                <label className="admin-wide-field">
                  <span>Descripción</span>
                  <input
                    value={selectedCategory.descripcion || ''}
                    onChange={(event) =>
                      setCategories((prev) =>
                        prev.map((cat) =>
                          Number(cat.id) === Number(selectedCategory.id)
                            ? { ...cat, descripcion: event.target.value }
                            : cat
                        )
                      )
                    }
                  />
                </label>
              </div>

              <div className="admin-actions-row">
                <button
                  className="admin-primary-btn"
                  onClick={() =>
                    handleUpdateCategory(selectedCategory.id, {
                      descripcion: selectedCategory.descripcion || '',
                      tiempo_sla_minutos: Number(selectedCategory.tiempo_sla_minutos || 60),
                      color: selectedCategory.color || '',
                      icono: selectedCategory.icono || '',
                    })
                  }
                  disabled={saving}
                >
                  Guardar cambios
                </button>
              </div>

              <div className="admin-section-split">
                <div className="admin-subsection">
                  <div className="admin-subsection-head">
                    <h4>Etiquetas</h4>
                    <span>{safeArray(selectedCategory.etiquetas).length}</span>
                  </div>

                  <div className="admin-chip-list">
                    {safeArray(selectedCategory.etiquetas).map((tag) => (
                      <button
                        key={tag.id}
                        className={`admin-chip ${tag.is_active ? '' : 'disabled'}`}
                        onClick={() => handleToggleTag(tag)}
                        disabled={saving}
                        title="Clic para activar/desactivar"
                      >
                        {tag.nombre}
                      </button>
                    ))}
                  </div>

                  <div className="admin-mini-form">
                    <input
                      value={tagForm.nombre}
                      onChange={(event) => setTagForm((prev) => ({ ...prev, nombre: event.target.value }))}
                      placeholder="Nueva etiqueta"
                    />
                    <button className="admin-primary-btn" onClick={handleAddTag} disabled={saving}>
                      Agregar
                    </button>
                  </div>
                </div>

                <div className="admin-subsection">
                  <div className="admin-subsection-head">
                    <h4>Preguntas de contexto</h4>
                    <span>{safeArray(selectedCategory.preguntas || selectedCategory.preguntas_contexto).length}</span>
                  </div>

                  <div className="admin-question-list">
                    {safeArray(selectedCategory.preguntas || selectedCategory.preguntas_contexto).map((question) => (
                      <div className={`admin-question-card ${question.is_active ? '' : 'disabled'}`} key={question.id}>
                        <div className="admin-question-head">
                          <div>
                            <strong>{question.pregunta}</strong>
                            <small>{question.is_required ? 'Requerida' : 'Opcional'}</small>
                          </div>
                          <button className="admin-link-action" onClick={() => handleToggleQuestion(question)} disabled={saving}>
                            {question.is_active ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>

                        <div className="admin-options-list">
                          {safeArray(question.opciones).map((option) => (
                            <button
                              key={option.id}
                              className={`admin-option-pill ${option.is_active ? '' : 'disabled'} p-${normalizePriorityClass(option.puntaje)}`}
                              onClick={() => handleToggleOption(option)}
                              disabled={saving}
                              title="Clic para activar/desactivar"
                            >
                              {option.nombre || option.texto}
                              <span>{option.puntaje} pts</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="admin-mini-form vertical">
                    <input
                      value={questionForm.pregunta}
                      onChange={(event) => setQuestionForm((prev) => ({ ...prev, pregunta: event.target.value }))}
                      placeholder="Nueva pregunta"
                    />

                    <label className="admin-checkline">
                      <input
                        type="checkbox"
                        checked={questionForm.is_required}
                        onChange={(event) => setQuestionForm((prev) => ({ ...prev, is_required: event.target.checked }))}
                      />
                      Requerida
                    </label>

                    <button className="admin-primary-btn" onClick={handleAddQuestion} disabled={saving}>
                      Agregar pregunta
                    </button>
                  </div>

                  <div className="admin-mini-form vertical">
                    <select
                      value={optionForm.pregunta_id}
                      onChange={(event) => setOptionForm((prev) => ({ ...prev, pregunta_id: event.target.value }))}
                    >
                      <option value="">Selecciona pregunta</option>
                      {safeArray(selectedCategory.preguntas || selectedCategory.preguntas_contexto).map((question) => (
                        <option key={question.id} value={question.id}>
                          {question.pregunta}
                        </option>
                      ))}
                    </select>

                    <div className="admin-option-form-grid">
                      <input
                        value={optionForm.texto}
                        onChange={(event) => setOptionForm((prev) => ({ ...prev, texto: event.target.value }))}
                        placeholder="Texto de opción"
                      />

                      <input
                        type="number"
                        value={optionForm.puntaje}
                        onChange={(event) => setOptionForm((prev) => ({ ...prev, puntaje: event.target.value }))}
                        placeholder="Puntaje"
                      />
                    </div>

                    <button className="admin-primary-btn" onClick={handleAddOption} disabled={saving}>
                      Agregar opción
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default CategoriesPage;