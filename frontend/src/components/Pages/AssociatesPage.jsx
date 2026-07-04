import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import PageHeader from './PageHeader';
import { ADMIN_API_URL as ADMIN_API } from '../../config/api';

const ROLE_OPTIONS = [
  { value: 'associate', label: 'Asociado', roleLabel: 'Asociado', defaultDepartment: 'VA' },
  { value: 'tech', label: 'Técnico', roleLabel: 'Técnico de Soporte', defaultDepartment: 'TI' },
  { value: 'admin', label: 'Administrador', roleLabel: 'Administrador TI', defaultDepartment: 'TI' },
];

function getHeaders(authToken) {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function formatFullName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeRole(role) {
  const value = normalizeText(role);

  if (value === 'tecnico') return 'tech';
  if (value === 'asociado') return 'associate';
  if (value === 'administrador') return 'admin';

  return value;
}

function getRoleLabel(role) {
  const normalized = normalizeRole(role);

  if (normalized === 'admin') return 'Administrador TI';
  if (normalized === 'tech') return 'Técnico de Soporte';
  if (normalized === 'associate') return 'Asociado';

  return role || 'Usuario';
}

function getRoleClass(role) {
  return normalizeRole(role).replace(/\s+/g, '-');
}

function localUsername(fullName) {
  const parts = String(fullName || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);

  if (!parts.length) return '';

  const firstName = parts[0];

  /*
    Regla práctica:
    - Katherine Garcia => katherine.garcia
    - Katherine Garcia Montano => katherine.montano
    - Carlos Antonio Alvarez Mendoza => carlos.alvarez
    - Carlos Antonio Alvarez => carlos.alvarez

    Con 2 palabras: usa primera + segunda.
    Con 3 o más: usa primera + tercera.
  */
  const firstLastName = parts.length >= 3 ? parts[2] : parts[1];

  if (!firstLastName) return firstName;

  return `${firstName}.${firstLastName}`;
}

function getDisplayDepartment(department, departments) {
  const found = safeArray(departments).find(
    (item) => item.code === department || item.name === department
  );

  if (!found) return department || '—';

  return found.code === found.name ? found.code : `${found.code} · ${found.name}`;
}

function getUserName(user) {
  return formatFullName(user.full_name || user.name || user.username || 'Usuario');
}

function getPresenceLabel(user) {
  if (!user) return '—';

  if (typeof user.presence === 'string') {
    return user.presence || '—';
  }

  if (user.presence && typeof user.presence === 'object') {
    return user.presence.estado || '—';
  }

  if (user.estado_presencia) {
    return user.estado_presencia;
  }

  return '—';
}

function getRatingForUser(user) {
  const role = normalizeRole(user.role);

  if (role === 'associate') {
    const rating = Number(user.avg_rating_as_associate);
    const count = Number(user.ratings_count_as_associate || 0);

    if (Number.isFinite(rating) && rating > 0) {
      return `${rating.toFixed(2)} (${count})`;
    }

    return '—';
  }

  if (role === 'tech') {
    const rating = Number(user.avg_rating_as_technician);
    const count = Number(user.ratings_count_as_technician || 0);

    if (Number.isFinite(rating) && rating > 0) {
      return `${rating.toFixed(2)} (${count})`;
    }

    return '—';
  }

  return '—';
}

function AssociatesPage({ authToken }) {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('active');

  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('HelpDesk2026*');

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    full_name: '',
    username: '',
    role: 'associate',
    role_label: 'Asociado',
    department: 'VA',
    password: 'HelpDesk2026*',
  });

  const loadDepartments = async () => {
    if (!authToken) return;

    try {
      const response = await axios.get(`${ADMIN_API}/departments`, {
        headers: getHeaders(authToken),
      });

      const rows = Array.isArray(response.data)
        ? response.data
        : response.data.departments || response.data.data || [];

      setDepartments(rows);
    } catch {
      setDepartments([
        { code: 'TI', name: 'Tecnología de Información' },
        { code: 'MKT', name: 'Marketing' },
        { code: 'VA', name: 'Virtual Assistants' },
        { code: 'ISA', name: 'Inside Sales' },
        { code: 'Operaciones', name: 'Operaciones' },
        { code: 'Contabilidad', name: 'Contabilidad' },
      ]);
    }
  };

  const loadUsers = async () => {
    if (!authToken) return;

    setLoading(true);
    setError('');

    try {
      const params = {};

      if (search.trim()) params.search = search.trim();
      if (roleFilter !== 'all') params.role = roleFilter;
      if (departmentFilter !== 'all') params.department = departmentFilter;
      if (activeFilter !== 'all') params.active = activeFilter === 'active' ? 'true' : 'false';

      const response = await axios.get(`${ADMIN_API}/users`, {
        headers: getHeaders(authToken),
        params,
      });

      const rows = Array.isArray(response.data)
        ? response.data
        : response.data.users || [];

      setUsers(rows);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo cargar el directorio de usuarios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDepartments();
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers();
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roleFilter, departmentFilter, activeFilter]);

  const stats = useMemo(() => {
    const list = safeArray(users);

    return {
      total: list.length,
      admins: list.filter((user) => normalizeRole(user.role) === 'admin').length,
      techs: list.filter((user) => normalizeRole(user.role) === 'tech').length,
      associates: list.filter((user) => normalizeRole(user.role) === 'associate').length,
    };
  }, [users]);

  const showSuccess = (text) => {
    setMessage(text);
    setError('');
    setTimeout(() => setMessage(''), 3200);
  };

  const suggestUsername = async (fullName) => {
    const fallback = localUsername(fullName);

    if (!fullName.trim()) {
      setForm((current) => ({ ...current, username: '' }));
      return;
    }

    setForm((current) => ({
      ...current,
      username: fallback,
    }));

    try {
      const response = await axios.get(`${ADMIN_API}/users/suggest-username`, {
        headers: getHeaders(authToken),
        params: { fullName: fallback },
      });

      const suggested = response.data?.username;

      if (suggested) {
        setForm((current) => ({
          ...current,
          username: suggested,
        }));
      }
    } catch {
      // El fallback local ya quedó aplicado.
    }
  };

  const updateFullName = (value) => {
    setError('');

    setForm((current) => ({
      ...current,
      full_name: value,
    }));

    suggestUsername(value);
  };

  const updateRole = (nextRole) => {
    const option = ROLE_OPTIONS.find((item) => item.value === nextRole);

    setForm((current) => ({
      ...current,
      role: nextRole,
      role_label: option?.roleLabel || getRoleLabel(nextRole),
      department: option?.defaultDepartment || current.department || 'TI',
    }));
  };

  const duplicateName = useMemo(() => {
    const name = normalizeText(form.full_name);
    if (!name) return null;

    return users.find((user) => normalizeText(user.full_name || user.name) === name);
  }, [form.full_name, users]);

  const duplicateUsername = useMemo(() => {
    const username = normalizeText(form.username);
    if (!username) return null;

    return users.find((user) => normalizeText(user.username) === username);
  }, [form.username, users]);

  const validateForm = () => {
    if (!form.full_name.trim()) return 'El nombre y apellido completo es obligatorio.';
    if (!form.username.trim()) return 'El usuario automático es obligatorio.';
    if (!form.role) return 'Seleccione un rol.';
    if (!form.role_label.trim()) return 'El rol aplicado es obligatorio.';
    if (!form.department.trim()) return 'Seleccione un departamento.';
    if (!form.password.trim()) return 'La contraseña temporal es obligatoria.';
    if (form.password.trim().length < 8) return 'La contraseña temporal debe tener al menos 8 caracteres.';
    if (duplicateName) return 'Ya existe un usuario con ese nombre completo.';
    if (duplicateUsername) return 'Ya existe un usuario con ese nombre de usuario.';

    return '';
  };

  const createUser = async () => {
    const validationError = validateForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await axios.post(
        `${ADMIN_API}/users`,
        {
          username: form.username.trim(),
          full_name: formatFullName(form.full_name),
          role: form.role,
          role_label: form.role_label.trim(),
          department: form.department.trim(),
          password: form.password.trim(),
        },
        {
          headers: getHeaders(authToken),
        }
      );

      setForm({
        full_name: '',
        username: '',
        role: 'associate',
        role_label: 'Asociado',
        department: 'VA',
        password: 'HelpDesk2026*',
      });

      setShowCreate(false);
      await loadUsers();
      showSuccess('Usuario creado correctamente. Deberá cambiar la contraseña en su primer inicio.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo crear el usuario.');
    } finally {
      setSaving(false);
    }
  };

  const toggleUser = async (user) => {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      await axios.post(
        `${ADMIN_API}/users/${user.id}/toggle`,
        {},
        { headers: getHeaders(authToken) }
      );

      if (user.is_active === false) {
        setActiveFilter('active');
        await loadUsers();
        showSuccess('Usuario activado correctamente.');
      } else {
        setActiveFilter('all');
        await loadUsers();
        showSuccess('Usuario desactivado correctamente. Ahora se muestra en la vista Todos.');
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo cambiar el estado del usuario.');
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (user) => {
    const confirmed = window.confirm(`¿Seguro que deseas eliminar a ${getUserName(user)}?`);

    if (!confirmed) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await axios.delete(`${ADMIN_API}/users/${user.id}`, {
        headers: getHeaders(authToken),
      });

      setActiveFilter('all');
      await loadUsers();
      showSuccess('Usuario eliminado correctamente.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo eliminar el usuario.');
    } finally {
      setSaving(false);
    }
  };

  const resetUserPassword = async () => {
    if (!resetTarget) return;

    if (!resetPassword.trim() || resetPassword.trim().length < 8) {
      setError('La nueva contraseña temporal debe tener al menos 8 caracteres.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await axios.post(
        `${ADMIN_API}/users/${resetTarget.id}/reset-password`,
        { password: resetPassword.trim() },
        { headers: getHeaders(authToken) }
      );

      setResetTarget(null);
      setResetPassword('HelpDesk2026*');
      await loadUsers();
      showSuccess('Contraseña temporal restablecida. El usuario deberá cambiarla al iniciar sesión.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'No se pudo restablecer la contraseña.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="module-page users-admin-page">
      <PageHeader
        title="Usuarios"
        subtitle="Administración de asociados, técnicos y administradores del sistema."
        actionLabel={showCreate ? 'Cerrar formulario' : '+ Nuevo usuario'}
        onAction={() => setShowCreate((current) => !current)}
      />

      {message && <div className="users-admin-success">✓ {message}</div>}
      {error && <div className="users-admin-error">⚠ {error}</div>}

      <div className="users-admin-summary">
        <article>
          <span>Total usuarios</span>
          <strong>{stats.total}</strong>
          <small>Según filtros actuales</small>
        </article>

        <article>
          <span>Administradores</span>
          <strong>{stats.admins}</strong>
          <small>Control total del sistema</small>
        </article>

        <article>
          <span>Técnicos</span>
          <strong>{stats.techs}</strong>
          <small>Responsables de atención</small>
        </article>

        <article>
          <span>Asociados</span>
          <strong>{stats.associates}</strong>
          <small>Solicitantes de soporte</small>
        </article>
      </div>

      {showCreate && (
        <div className="panel users-create-panel">
          <div className="users-section-head">
            <div>
              <h3>Crear usuario</h3>
              <p>Define nombre, rol, departamento y contraseña temporal. El usuario y el rol visible se generan automáticamente.</p>
            </div>
          </div>

          <div className="users-form-grid">
            <label>
              <span>Nombre y apellido completo</span>
              <input
                value={form.full_name}
                onChange={(event) => updateFullName(event.target.value)}
                placeholder="Nombre y apellido"
              />
              {duplicateName && <small className="users-field-error">Ya existe ese nombre.</small>}
            </label>

            <label>
              <span>Usuario automático</span>
              <input
                value={form.username}
                readOnly
                className="readonly-input"
                placeholder="Se genera automáticamente"
              />
              {duplicateUsername && <small className="users-field-error">Ya existe ese usuario.</small>}
            </label>

            <label>
              <span>Rol</span>
              <select value={form.role} onChange={(event) => updateRole(event.target.value)}>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Rol aplicado</span>
              <input
                value={form.role_label}
                readOnly
                className="readonly-input"
                placeholder="Se define automáticamente"
              />
            </label>

            <label>
              <span>Departamento</span>
              <select
                value={form.department}
                onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))}
              >
                {safeArray(departments).map((department) => (
                  <option key={department.code || department.name} value={department.code || department.name}>
                    {department.code || department.name} · {department.name || department.code}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Contraseña temporal</span>
              <input
                type="text"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Contraseña temporal"
              />
            </label>
          </div>

          <div className="users-create-preview">
            <span>Vista previa</span>
            <strong>{form.full_name ? formatFullName(form.full_name) : 'Nuevo usuario'}</strong>
            <small>
              {form.username || 'usuario'} · {form.role_label || getRoleLabel(form.role)} · {getDisplayDepartment(form.department, departments)}
            </small>
          </div>

          <div className="users-actions-row">
            <button className="users-primary-btn" onClick={createUser} disabled={saving || duplicateName || duplicateUsername}>
              {saving ? 'Creando...' : 'Crear usuario'}
            </button>

            <button className="users-secondary-btn" onClick={() => setShowCreate(false)} disabled={saving}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="panel users-directory-panel">
        <div className="users-section-head">
          <div>
            <h3>Directorio de usuarios</h3>
            <p>{loading ? 'Cargando usuarios...' : `${users.length} usuarios visibles`}</p>
          </div>

          <button className="users-secondary-btn" onClick={loadUsers} disabled={loading}>
            Refrescar
          </button>
        </div>

        <div className="users-toolbar users-toolbar-extended">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, usuario o departamento..."
          />

          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">Todos los roles</option>
            <option value="admin">Administradores</option>
            <option value="tech">Técnicos</option>
            <option value="associate">Asociados</option>
          </select>

          <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
            <option value="all">Todos los departamentos</option>
            {safeArray(departments).map((department) => (
              <option key={department.code || department.name} value={department.code || department.name}>
                {department.code || department.name} · {department.name || department.code}
              </option>
            ))}
          </select>

          <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </div>

        <div className="users-table">
          <div className="users-row users-row-with-actions head">
            <span>Usuario</span>
            <span>Rol</span>
            <span>Departamento</span>
            <span>Estado</span>
            <span>Presencia</span>
            <span>Calificación</span>
            <span>Acciones</span>
          </div>

          {users.map((user) => {
            const role = normalizeRole(user.role);
            const active = user.is_active !== false;
            const rating = getRatingForUser(user);

            return (
              <div className="users-row users-row-with-actions" key={user.id}>
                <span>
                  <strong>{getUserName(user)}</strong>
                  <small>
                    {user.username}
                    {user.must_change_password || user.mustChangePassword ? ' · Cambio pendiente' : ''}
                  </small>
                </span>

                <span>
                  <em className={`users-role-pill ${getRoleClass(role)}`}>
                    {user.role_label || getRoleLabel(role)}
                  </em>
                </span>

                <span>{getDisplayDepartment(user.department, departments)}</span>

                <span>
                  <em className={active ? 'users-state active' : 'users-state inactive'}>
                    {active ? 'Activo' : 'Inactivo'}
                  </em>
                </span>

                <span>{role === 'tech' ? getPresenceLabel(user) : '—'}</span>

                <span>⭐ {rating}</span>

                <span className="users-action-buttons">
                  <button
                    className="users-mini-btn"
                    type="button"
                    onClick={() => {
                      setResetTarget(user);
                      setResetPassword('HelpDesk2026*');
                    }}
                    disabled={saving}
                  >
                    Reset clave
                  </button>

                  <button
                    className="users-mini-btn"
                    type="button"
                    onClick={() => toggleUser(user)}
                    disabled={saving}
                  >
                    {active ? 'Bloquear acceso' : 'Activar acceso'}
                  </button>

                  <button
                    className="users-mini-btn danger"
                    type="button"
                    onClick={() => deleteUser(user)}
                    disabled={saving}
                  >
                    Eliminar
                  </button>
                </span>
              </div>
            );
          })}

          {!loading && !users.length && (
            <div className="users-empty-state">
              <strong>No hay usuarios que coincidan con los filtros.</strong>
              <p>Cambia el filtro o crea un nuevo usuario.</p>
            </div>
          )}
        </div>
      </div>

      {resetTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="resolved-modal users-reset-modal">
            <button
              className="modal-close"
              type="button"
              onClick={() => setResetTarget(null)}
              aria-label="Cerrar"
            >
              ×
            </button>

            <h2>Resetear contraseña</h2>
            <p>
              Usuario: <strong>{getUserName(resetTarget)}</strong>
            </p>

            <label className="modal-field">
              <span>Nueva contraseña temporal</span>
              <input
                type="text"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
              />
            </label>

            <small>Al iniciar sesión, el usuario deberá cambiar esta contraseña.</small>

            <div className="modal-actions">
              <button className="green" onClick={resetUserPassword} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar contraseña'}
              </button>

              <button className="red" onClick={() => setResetTarget(null)} disabled={saving}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default AssociatesPage;