import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import './App.css';

import { LoginPage } from './components/Auth';
import { Sidebar, Topbar } from './components/Layout';
import RatingsPage from './components/Pages/RatingsPage';
import { TechnicianDashboard } from './components/Technician';
import { AssociateDashboard } from './components/Associate';
import { ResolvedModal, CreateTicketModal, PresenceReasonModal, CriticalAlert } from './components/Shared';
import { createHelpdeskSocket } from './services/socket';
import { subscribeToPush } from './services/push';
import {
  TicketsPage,
  TechniciansPage,
  AssociatesPage,
  WikiPage,
  ReportsPage,
  SettingsPage,
  AuditLogPage,
  CreateTicketPage,
  ProfilePage,
  ChatPage,
  NewsPage,
  CategoriesPage,
} from './components/Pages';
import { API_URL, AUTH_API_URL, TECHNICIAN_API_URL, PRESENCE_API_URL, ADMIN_API_URL, normalizeTicket, countByState } from './data/helpdeskData';

function normalizeState(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function getPlannedDate(ticket) {
  return parseDateSafe(
    ticket?.fecha_planificada ||
      ticket?.planned_at ||
      ticket?.plannedAt ||
      ticket?.scheduledAt
  );
}

function hasPlannedTimeConflict(ticket) {
  const plannedDate = getPlannedDate(ticket);
  if (!plannedDate) return false;

  const now = new Date();
  const slaMinutes = Number(ticket?.sla_objetivo_minutos || 60);

  const windowStart = new Date(plannedDate.getTime() - 30 * 60 * 1000);
  const windowEnd = new Date(plannedDate.getTime() + slaMinutes * 60 * 1000);

  return now >= windowStart && now <= windowEnd;
}

function createIdempotencyKey(scope = 'action') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${scope}-${crypto.randomUUID()}`;
  }
  return `${scope}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isPasswordChangeRequired(user) {
  return Boolean(user?.mustChangePassword || user?.must_change_password);
}

function getApiErrorMessage(error, fallback = 'No se pudo completar la acción.') {
  const data = error?.response?.data || {};
  const code = data.code || data.error_code;

  const messages = {
    INVALID_TICKET_STATE: 'El ticket ya cambió de estado. Actualiza la información e inténtalo nuevamente.',
    ACTIVE_TICKET_EXISTS: 'Ya tienes un ticket activo. Debes esperar a que sea cerrado antes de crear otro.',
    PLANNED_SAME_CATEGORY_EXISTS: 'Ya tienes un ticket planificado para esa misma categoría.',
    PLANNED_TIME_CONFLICT: 'Ya tienes una atención planificada para ese momento.',
    MUST_CHANGE_PASSWORD: 'Debes cambiar tu contraseña temporal antes de continuar.',
    IDEMPOTENCY_CONFLICT: 'Esta acción ya se está procesando. Espera unos segundos.',
    UNAUTHORIZED: 'Tu sesión expiró o no tienes permiso para esta acción.',
    FORBIDDEN: 'No tienes permiso para realizar esta acción.',
  };

  return data.error || data.message || messages[code] || fallback;
}

function ChangePasswordGate({ currentUser, authToken, onChanged, onLogout }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (field, value) => {
    setError('');
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.currentPassword.trim()) {
      setError('Ingresa tu contraseña temporal actual.');
      return;
    }
    if (form.newPassword.trim().length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    if (form.currentPassword === form.newPassword) {
      setError('La nueva contraseña debe ser diferente a la temporal.');
      return;
    }

    setSaving(true);
    try {
      const response = await axios.post(`${AUTH_API_URL}/change-password`, {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
        current_password: form.currentPassword,
        new_password: form.newPassword,
        password: form.newPassword,
      }, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Idempotency-Key': createIdempotencyKey('change-password'),
        },
      });

      const updatedUser = {
        ...currentUser,
        ...(response.data?.user || {}),
        mustChangePassword: false,
        must_change_password: false,
      };
      onChanged(updatedUser, response.data?.token);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No se pudo cambiar la contraseña.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="password-gate-screen">
      <section className="password-gate-card">
        <div className="login-logo-mark">🔐</div>
        <span className="secure-dot">● Cambio obligatorio</span>
        <h1>Actualiza tu contraseña</h1>
        <p>
          Hola, <strong>{currentUser?.name || currentUser?.full_name || currentUser?.username}</strong>. Antes de usar HelpDesk_X debes reemplazar la contraseña temporal asignada por el administrador.
        </p>
        <form className="password-gate-form" onSubmit={submit}>
          <label>
            Contraseña temporal actual
            <input
              type="password"
              value={form.currentPassword}
              onChange={(event) => update('currentPassword', event.target.value)}
              autoComplete="current-password"
              disabled={saving}
            />
          </label>
          <label>
            Nueva contraseña
            <input
              type="password"
              value={form.newPassword}
              onChange={(event) => update('newPassword', event.target.value)}
              autoComplete="new-password"
              disabled={saving}
            />
          </label>
          <label>
            Confirmar nueva contraseña
            <input
              type="password"
              value={form.confirmPassword}
              onChange={(event) => update('confirmPassword', event.target.value)}
              autoComplete="new-password"
              disabled={saving}
            />
          </label>
          {error && <div className="login-error">{error}</div>}
          <button className="login-submit" type="submit" disabled={saving}>
            {saving ? 'Actualizando...' : 'Guardar nueva contraseña'}
          </button>
        </form>
        <button className="password-gate-logout" type="button" onClick={onLogout} disabled={saving}>
          Cerrar sesión
        </button>
      </section>
    </main>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('helpdesk_x_user')) || null;
    } catch {
      return null;
    }
  });

  const [authToken, setAuthToken] = useState(() => localStorage.getItem('helpdesk_x_token') || '');
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [activePanel, setActivePanel] = useState('dashboard');
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showResolvedModal, setShowResolvedModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTicketDetails, setShowTicketDetails] = useState(false);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const [techStatus, setTechStatus] = useState('Activo');
  const [catalog, setCatalog] = useState([]);
  const [presenceRequest, setPresenceRequest] = useState(null);
  const [criticalTicket, setCriticalTicket] = useState(null);
  const [pushEnabled, setPushEnabled] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const [technicianDirectory, setTechnicianDirectory] = useState({ users: [], presence: [] });
  const [actionLocks, setActionLocks] = useState({});

  const role = currentUser?.role || 'guest';
  const isLocked = (key) => Boolean(actionLocks[key]);

  const withActionLock = async (key, task) => {
    if (actionLocks[key]) return null;
    setActionLocks((current) => ({ ...current, [key]: true }));
    try {
      return await task();
    } finally {
      setActionLocks((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const authHeaders = ({ idempotent = false, scope = 'action' } = {}) => {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    if (idempotent) {
      headers['Idempotency-Key'] = createIdempotencyKey(scope);
    }
    return headers;
  };

  const loadTickets = async ({ silent = false } = {}) => {
    try {
      const response = await axios.get(API_URL, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const rows = Array.isArray(response.data) ? response.data : [];
      const normalized = rows.map(normalizeTicket);

      setTickets(normalized);
      setSelectedId((current) => normalized.some((ticket) => ticket.id === current) ? current : normalized[0]?.id || null);

      if (!silent) {
        setToast(rows.length ? 'Tickets cargados desde PostgreSQL' : 'No hay tickets registrados para este usuario');
      }
    } catch (error) {
      console.error('Error cargando tickets:', error);
      setTickets([]);
      setSelectedId(null);
      if (!silent) setToast(getApiErrorMessage(error, 'No se pudieron cargar los tickets desde el backend'));
    } finally {
      setLoading(false);
    }
  };

  const loadCatalog = async () => {
    if (!authToken) return;
    try {
      const response = await axios.get(`${API_URL}/catalog`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setCatalog(response.data || []);
    } catch (error) {
      console.warn('No se pudo cargar catálogo:', error.message);
    }
  };

  const loadTechnicianDirectory = async () => {
    if (!authToken || role !== 'admin' || isPasswordChangeRequired(currentUser)) return;
    try {
      const response = await axios.get(`${ADMIN_API_URL}/directory`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setTechnicianDirectory(response.data);
    } catch (error) {
      setTechnicianDirectory({ users: [], presence: [] });
    }
  };

  const refreshOperationalData = async ({ silent = true } = {}) => {
    if (!currentUser || !authToken || isPasswordChangeRequired(currentUser)) return;
    await loadTickets({ silent });
    if (role === 'admin') {
      await loadTechnicianDirectory();
    }
  };

  useEffect(() => {
    if (currentUser && authToken && !isPasswordChangeRequired(currentUser)) {
      loadTickets();
      loadCatalog();
    } else {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, authToken]);

  useEffect(() => {
    loadTechnicianDirectory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, role]);

  useEffect(() => {
    if (!currentUser || !authToken || isPasswordChangeRequired(currentUser)) return undefined;

    const refreshSilently = () => {
      refreshOperationalData({ silent: true });
    };

    const interval = setInterval(refreshSilently, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshSilently();
    };
    const handleWindowFocus = () => {
      refreshSilently();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, authToken, role]);

  useEffect(() => {
    if (!authToken || isPasswordChangeRequired(currentUser)) return undefined;

    loadCatalog();
    const socket = createHelpdeskSocket(authToken);
    const refresh = () => refreshOperationalData({ silent: true });

    socket.on('ticket:created', refresh);
    socket.on('ticket:assigned', (ticket) => {
      if (currentUser?.role === 'tech') {
        setCriticalTicket(String(ticket.prioridad).toLowerCase().includes('crit') ? normalizeTicket(ticket) : null);
      }
      refresh();
    });

    socket.on('ticket:started', refresh);
    socket.on('ticket:planned', refresh);
    socket.on('ticket:waiting', refresh);
    socket.on('ticket:closed', refresh);
    socket.on('ticket:updated', refresh);
    socket.on('ticket:locked', refresh);
    socket.on('ticket:reopened', refresh);
    socket.on('ticket:reassigned', refresh);
    socket.on('critical:alert', (ticket) => setCriticalTicket(normalizeTicket(ticket)));

    socket.on('ticket:resolved', (ticket) => {
      if (currentUser?.role === 'associate') {
        setSelectedId(ticket.id);
        setShowResolvedModal(true);
      }
      refresh();
    });

    socket.on('presence:changed', (presence) => {
      if (currentUser?.role === 'tech' && Number(presence.tecnico_id) === Number(currentUser.id)) {
        setTechStatus(presence.estado);
      }
      setTechnicianDirectory((current) => ({
        ...current,
        presence: [...current.presence.filter((item) => item.tecnico_id !== presence.tecnico_id), presence],
      }));
      refresh();
    });

    const heartbeat = currentUser?.role === 'tech' ? setInterval(() => socket.emit('heartbeat'), 30000) : null;

    return () => {
      if (heartbeat) clearInterval(heartbeat);
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (role !== 'associate' || isPasswordChangeRequired(currentUser)) return;

    const pending = tickets.find((ticket) =>
      String(ticket.estado || '').toLowerCase().includes('resuelto') &&
      ticket.pendingAssociateRating !== false
    );

    if (pending) {
      setSelectedId(pending.id);
      setShowResolvedModal(true);
    } else {
      setShowResolvedModal(false);
    }
  }, [tickets, role]);

  useEffect(() => {
    if (!criticalTicket) return undefined;

    const originalTitle = document.title;
    const favicon = document.querySelector("link[rel*='icon']");
    const originalFavicon = favicon?.href;
    const alertFavicon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#ef4444"/><text x="32" y="44" font-size="38" text-anchor="middle" fill="white">!</text></svg>')}`;

    let flip = false;
    const titleTimer = setInterval(() => {
      flip = !flip;
      document.title = flip ? '🚨 NUEVO TICKET CRÍTICO' : originalTitle;
      if (favicon) favicon.href = flip ? alertFavicon : originalFavicon;
    }, 500);

    const beep = () => {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      oscillator.frequency.value = 880;
      oscillator.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 3);
      oscillator.onended = () => ctx.close();
    };

    beep();
    const audioTimer = setInterval(beep, 18000);

    return () => {
      clearInterval(titleTimer);
      clearInterval(audioTimer);
      document.title = originalTitle;
      if (favicon) favicon.href = originalFavicon;
    };
  }, [criticalTicket]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError('');
    setAuthLoading(true);

    try {
      const response = await axios.post(`${AUTH_API_URL}/login`, {
        username: credentials.username.trim(),
        password: credentials.password,
      });

      const { token, user } = response.data;
      if (!token || !user) throw new Error('Respuesta de autenticación incompleta.');

      localStorage.setItem('helpdesk_x_token', token);
      localStorage.setItem('helpdesk_x_user', JSON.stringify(user));

      setAuthToken(token);
      setCurrentUser(user);
      setCredentials({ username: '', password: '' });
      setActivePanel('dashboard');
      setToast(isPasswordChangeRequired(user) ? 'Debes cambiar tu contraseña temporal.' : `Bienvenido, ${user.name || user.full_name || user.username}. Rol: ${user.roleLabel || user.role_label || user.role}`);

      if (user.role === 'tech') setTechStatus('Activo');
    } catch (error) {
      const message = error.response?.data?.error || 'No se pudo iniciar sesión. Verifica backend, usuario y contraseña.';
      setLoginError(message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (authToken) {
        await axios.post(`${AUTH_API_URL}/logout`, {}, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
      }
    } catch (error) {
      console.warn('No se pudo cerrar sesión en backend:', error.message);
    }

    localStorage.removeItem('helpdesk_x_token');
    localStorage.removeItem('helpdesk_x_user');
    setAuthToken('');
    setCurrentUser(null);
    setActivePanel('dashboard');
    setSidebarCollapsed(false);
    setTechStatus('Activo');
    setPushEnabled(typeof Notification !== 'undefined' && Notification.permission === 'granted');
    setToast('Sesión cerrada correctamente');
  };

  const handlePasswordChanged = (updatedUser, nextToken) => {
    const finalToken = nextToken || authToken;
    if (nextToken) {
      localStorage.setItem('helpdesk_x_token', nextToken);
      setAuthToken(nextToken);
    }
    localStorage.setItem('helpdesk_x_user', JSON.stringify(updatedUser));
    setCurrentUser(updatedUser);
    setCredentials({ username: '', password: '' });
    setActivePanel('dashboard');
    setToast('Contraseña actualizada correctamente.');

    if (finalToken) {
      setTimeout(() => refreshOperationalData({ silent: true }), 250);
    }
  };

  const enablePushNotifications = async () => {
    try {
      const enabled = await subscribeToPush(authToken);
      setPushEnabled(enabled);
      setToast(enabled ? 'Alertas críticas activadas.' : 'No se concedió permiso para las notificaciones.');
    } catch (error) {
      setToast('No se pudieron activar las notificaciones en este navegador.');
    }
  };

  const selectedTicket = tickets.find((ticket) => ticket.id === selectedId) || tickets[0] || null;

  const metrics = useMemo(() => {
    const total = tickets.length;
    const resueltos = countByState(tickets, 'resuelto') + countByState(tickets, 'cerrado');
    const enProceso = countByState(tickets, 'proceso') + countByState(tickets, 'progreso');
    const enEspera = countByState(tickets, 'espera');
    const planificados = countByState(tickets, 'plan');

    return {
      total,
      resueltos,
      enProceso,
      enEspera,
      planificados,
      abiertos: countByState(tickets, 'abierto'),
    };
  }, [tickets]);

  const categoryData = useMemo(() => {
    const map = { Software: 0, Hardware: 0, Redes: 0, Accesos: 0, Otros: 0 };
    tickets.forEach((ticket) => {
      const key = map[ticket.categoria] !== undefined ? ticket.categoria : 'Otros';
      map[key] += 1;
    });
    return map;
  }, [tickets]);

  const navigateTo = (panelId) => {
    if (panelId === 'logout') {
      handleLogout();
      return;
    }
    if (panelId === 'tickets' && role !== 'admin') {
      setActivePanel('dashboard');
      return;
    }
    if (['dashboard', 'tickets', 'myTickets', 'waiting', 'planned', 'reports', 'technicians', 'associates'].includes(panelId)) {
      refreshOperationalData({ silent: true });
    }
    setActivePanel(panelId);
  };

  const resolveTicket = async () => {
    if (!selectedTicket?.id) return;
    if (role === 'tech') {
      await handleTechnicianAction(selectedTicket.id, 'resolve');
      return;
    }
    setShowResolvedModal(true);
    setToast(`Ticket #${String(selectedTicket.id).padStart(6, '0')} marcado como resuelto`);
  };

  const createTicket = async (formData) => {
    return withActionLock('create-ticket', async () => {
      try {
        const response = await axios.post(API_URL, {
          titulo: formData.titulo || formData.categoria,
          titulo_tecnico: formData.titulo_tecnico,
          descripcion: formData.descripcion,
          categoria: formData.categoria,
          etiqueta: formData.etiqueta,
          etiqueta_id: formData.etiqueta_id,
          respuestas_contexto: formData.respuestas,
          respuestas: formData.respuestas,
          priorityPreview: formData.priorityPreview,
          puntaje_prioridad: formData.puntaje_prioridad,
        }, {
          headers: authHeaders({ idempotent: true, scope: 'create-ticket' }),
        });

        const rawTicket = response.data.ticket || response.data;
        const newTicket = normalizeTicket(rawTicket);

        setTickets((prev) => [newTicket, ...prev.filter((ticket) => ticket.id !== newTicket.id)]);
        setSelectedId(newTicket.id);
        setActivePanel(role === 'associate' ? 'myTickets' : 'tickets');
        setShowCreateModal(false);
        setToast(`Ticket #${String(newTicket.id).padStart(6, '0')} creado correctamente`);

        setTimeout(() => refreshOperationalData({ silent: true }), 250);
      } catch (error) {
        const message = getApiErrorMessage(error, 'No se pudo crear el ticket desde backend.');
        setToast(message);
        throw error;
      }
    });
  };

  const openTicketFromList = (ticketId) => {
    setSelectedId(ticketId);
    setActivePanel('dashboard');
    refreshOperationalData({ silent: true });
    setToast(`Ticket #${String(ticketId).padStart(6, '0')} seleccionado`);
  };

  const handleTechnicianAction = async (ticketId, action, payload = {}) => {
    const lockKey = `ticket-${ticketId}-${action}`;
    return withActionLock(lockKey, async () => {
      const actionLabel = {
        start: 'iniciado',
        wait: 'puesto en espera',
        plan: 'planificado',
        resolve: 'marcado como resuelto',
        reject: 'rechazado con justificación',
      }[action] || 'actualizado';

      try {
        const response = await axios.post(`${TECHNICIAN_API_URL}/tickets/${ticketId}/${action}`, {
          technicianId: currentUser?.id,
          technicianName: currentUser?.name || currentUser?.full_name || currentUser?.username,
          ...payload,
        }, {
          headers: authHeaders({ idempotent: true, scope: `${action}-${ticketId}` }),
        });

        const updatedTicket = normalizeTicket(response.data.ticket || response.data);
        setTickets((prev) => prev.map((ticket) => ticket.id === updatedTicket.id ? updatedTicket : ticket));
        setSelectedId(updatedTicket.id);
        setToast(`Ticket #${String(updatedTicket.id).padStart(6, '0')} ${actionLabel}`);

        if (action === 'start') setTechStatus('Ocupado');
        if (['wait', 'plan', 'resolve', 'reject'].includes(action)) setTechStatus('Activo');
        if (action === 'start' && criticalTicket?.id === updatedTicket.id) setCriticalTicket(null);

        setTimeout(() => refreshOperationalData({ silent: true }), 250);
        return updatedTicket;
      } catch (error) {
        const message = getApiErrorMessage(error, 'No se pudo actualizar el ticket desde backend.');
        setToast(message);
        throw error;
      }
    });
  };

  const sendTicketMessage = async (ticketId, message, type) => {
    await axios.post(`${API_URL}/${ticketId}/messages`, {
      mensaje: message,
      tipo_mensaje: type,
    }, {
      headers: authHeaders({ idempotent: true, scope: `message-${ticketId}` }),
    });
    setToast('Mensaje agregado a la bitácora.');
    setTimeout(() => refreshOperationalData({ silent: true }), 250);
  };

  const updateTechnicianStatus = async (nextStatus, automaticReason = '') => {
    if (['En Break', 'Fuera de Servicio'].includes(nextStatus) && !automaticReason) {
      setPresenceRequest(nextStatus);
      return;
    }
    try {
      await axios.put(`${PRESENCE_API_URL}/me`, {
        estado: nextStatus,
        razon: automaticReason,
      }, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setTechStatus(nextStatus);
      setToast(`Estado actualizado a ${nextStatus}`);
      setTimeout(() => refreshOperationalData({ silent: true }), 250);
    } catch (error) {
      setToast(getApiErrorMessage(error, 'No se pudo actualizar tu presencia.'));
    }
  };

  const confirmPresence = async (reason) => {
    const status = presenceRequest;
    setPresenceRequest(null);
    await updateTechnicianStatus(status, reason);
  };

  const submitFeedback = async (feedbackOrRating, maybeComment) => {
    if (!selectedTicket?.id) return;
    const payload = typeof feedbackOrRating === 'object'
      ? feedbackOrRating
      : { score: feedbackOrRating, comment: maybeComment, resolved: true };

    return withActionLock(`feedback-${selectedTicket.id}`, async () => {
      await axios.post(`${API_URL}/${selectedTicket.id}/feedback`, {
        score: payload.score,
        comment: payload.comment,
        resolved: true,
        puntuacion: payload.score,
        comentario_evidencia: payload.comment,
      }, {
        headers: authHeaders({ idempotent: true, scope: `feedback-${selectedTicket.id}` }),
      });
      setShowResolvedModal(false);
      await refreshOperationalData({ silent: true });
      setToast('Gracias. El ticket fue cerrado.');
    });
  };

  const persistFailure = async (persistPayload) => {
    if (!selectedTicket?.id) return;
    const comment = typeof persistPayload === 'object' ? persistPayload.comment : persistPayload;

    return withActionLock(`persist-${selectedTicket.id}`, async () => {
      await axios.post(`${API_URL}/${selectedTicket.id}/persist`, {
        comment,
        comentario: comment,
        resolved: false,
      }, {
        headers: authHeaders({ idempotent: true, scope: `persist-${selectedTicket.id}` }),
      });
      setShowResolvedModal(false);
      await refreshOperationalData({ silent: true });
      setToast('El ticket regresó a En Progreso.');
    });
  };

  const openResolvedTicket = (ticketOrId) => {
    const id = typeof ticketOrId === 'object' ? ticketOrId.id : ticketOrId;
    setSelectedId(id);
    setShowResolvedModal(true);
  };

  const openAssociateTicket = (ticketId) => {
    setSelectedId(ticketId);
    setShowTicketDetails(true);
  };

  const getCreateTicketBlocker = () => {
    if (role !== 'associate') return null;

    const activeTicket = tickets.find((ticket) => {
      const state = normalizeState(ticket.estado);
      return (
        state.includes('abierto') ||
        state.includes('nuevo') ||
        state.includes('progreso') ||
        state.includes('proceso') ||
        state.includes('espera') ||
        state.includes('resuelto')
      );
    });

    if (activeTicket) {
      return {
        message: 'Tienes un ticket en progreso. Debes esperar a que sea cerrado antes de crear otro.',
        ticket: activeTicket,
      };
    }

    const plannedConflict = tickets.find((ticket) => {
      const state = normalizeState(ticket.estado);
      return state.includes('plan') && hasPlannedTimeConflict(ticket);
    });

    if (plannedConflict) {
      return {
        message: 'Ya tienes una atención planificada para este momento. Espera a que finalice o contacta a TI si es urgente.',
        ticket: plannedConflict,
      };
    }
    return null;
  };

  const applyTicketUpdate = (rawTicket) => {
    if (!rawTicket) return null;
    const updatedTicket = normalizeTicket(rawTicket);

    setTickets((prev) => {
      const exists = prev.some((ticket) => String(ticket.id) === String(updatedTicket.id));
      if (!exists) return [updatedTicket, ...prev];
      return prev.map((ticket) => String(ticket.id) === String(updatedTicket.id) ? updatedTicket : ticket);
    });

    setSelectedId(updatedTicket.id);
    return updatedTicket;
  };

  const adminRetryAssignment = async (ticketId) => {
    if (!ticketId || role !== 'admin') return null;
    return withActionLock(`admin-retry-${ticketId}`, async () => {
      try {
        const response = await axios.post(`${ADMIN_API_URL}/tickets/${ticketId}/reassign`, {}, {
          headers: authHeaders({ idempotent: true, scope: `admin-retry-${ticketId}` }),
        });
        const updatedTicket = applyTicketUpdate(response.data?.ticket || response.data?.data || response.data);
        await refreshOperationalData({ silent: true });
        setToast(updatedTicket?.tecnico_id || updatedTicket?.tecnico !== 'Sin asignar'
          ? `Ticket #${String(ticketId).padStart(6, '0')} reasignado automáticamente.`
          : `Ticket #${String(ticketId).padStart(6, '0')} sigue sin técnico elegible.`);
        return response.data;
      } catch (error) {
        const message = getApiErrorMessage(error, 'No se pudo reintentar la asignación.');
        setToast(message);
        throw error;
      }
    });
  };

  const adminAssignTicket = async (ticketId, technicianId, reason = 'Asignación manual por administrador') => {
    if (!ticketId || !technicianId || role !== 'admin') return null;
    return withActionLock(`admin-assign-${ticketId}`, async () => {
      try {
        const response = await axios.post(`${ADMIN_API_URL}/tickets/${ticketId}/assign`, {
          tecnico_id: technicianId,
          technicianId,
          technician_id: technicianId,
          reason,
          motivo: reason,
        }, {
          headers: authHeaders({ idempotent: true, scope: `admin-assign-${ticketId}` }),
        });
        const updatedTicket = applyTicketUpdate(response.data?.ticket || response.data?.data || response.data);
        await refreshOperationalData({ silent: true });
        setToast(`Ticket #${String(ticketId).padStart(6, '0')} asignado manualmente.`);
        return updatedTicket;
      } catch (error) {
        const message = getApiErrorMessage(error, 'No se pudo asignar manualmente el ticket.');
        setToast(message);
        throw error;
      }
    });
  };

  const adminSimulateAssignment = async (ticketId) => {
    if (!ticketId || role !== 'admin') return null;
    try {
      const response = await axios.post(`${ADMIN_API_URL}/tickets/${ticketId}/simulate-assignment`, {}, {
        headers: authHeaders({ idempotent: true, scope: `admin-simulate-${ticketId}` }),
      });
      return response.data;
    } catch (error) {
      const message = getApiErrorMessage(error, 'No se pudo simular la asignación.');
      setToast(message);
      throw error;
    }
  };

  const openCreateTicketModal = () => {
    const blocker = getCreateTicketBlocker();
    if (blocker) {
      setToast(blocker.message);
      return;
    }
    setShowCreateModal(true);
  };

  // Renderizador unificado para el Administrador utilizando los componentes modulares de Page
  const renderAdminPanels = () => {
    switch (activePanel) {
      case 'dashboard':
      case 'tickets':
        return (
          <TicketsPage
            tickets={tickets}
            onSelectTicket={openTicketFromList}
            selectedId={selectedId}
            selectedTicket={selectedTicket}
            onRetryAssignment={adminRetryAssignment}
            onAssignTicket={adminAssignTicket}
            onSimulateAssignment={adminSimulateAssignment}
            technicianDirectory={technicianDirectory}
          />
        );
      case 'technicians':
        return <TechniciansPage directory={technicianDirectory} />;
      case 'associates':
        return <AssociatesPage />;
      case 'ratings':
        return <RatingsPage />;
      case 'reports':
        return <ReportsPage metrics={metrics} categoryData={categoryData} />;
      case 'auditLog':
        return <AuditLogPage />;
      case 'categories':
        return <CategoriesPage catalog={catalog} />;
      case 'wiki':
        return <WikiPage />;
      case 'settings':
        return <SettingsPage pushEnabled={pushEnabled} onEnablePush={enablePushNotifications} />;
      case 'profile':
        return <ProfilePage user={currentUser} />;
      case 'chat':
        return <ChatPage user={currentUser} />;
      case 'news':
        return <NewsPage />;
      default:
        return <TicketsPage tickets={tickets} onSelectTicket={openTicketFromList} selectedId={selectedId} />;
    }
  };

  if (loading) {
    return (
      <div className="app-loading-screen">
        <div className="app-spinner" />
        <p>Cargando HelpDesk_X...</p>
      </div>
    );
  }

  if (!currentUser || !authToken) {
    return (
      <LoginPage
        credentials={credentials}
        onChangeCredentials={setCredentials}
        onLogin={handleLogin}
        error={loginError}
        loading={authLoading}
      />
    );
  }

  if (isPasswordChangeRequired(currentUser)) {
    return (
      <ChangePasswordGate
        currentUser={currentUser}
        authToken={authToken}
        onChanged={handlePasswordChanged}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        role={role}
        activePanel={activePanel}
        collapsed={sidebarCollapsed}
        onNavigate={navigateTo}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className="app-main-content">
        <Topbar
          user={currentUser}
          techStatus={techStatus}
          onStatusChange={updateTechnicianStatus}
          onLogout={handleLogout}
          onNavigate={navigateTo}
        />
        
        <main className="app-panel-viewport">
          {role === 'associate' && (
            <AssociateDashboard
              activePanel={activePanel}
              tickets={tickets}
              onCreateClick={openCreateTicketModal}
              onTicketClick={openAssociateTicket}
              onOpenFeedback={openResolvedTicket}
              onNavigate={navigateTo}
            />
          )}

          {role === 'tech' && (
            <TechnicianDashboard
              activePanel={activePanel}
              tickets={tickets}
              selectedId={selectedId}
              selectedTicket={selectedTicket}
              techStatus={techStatus}
              onSelectTicket={setSelectedId}
              onAction={handleTechnicianAction}
              onSendMessage={sendTicketMessage}
              onStatusChange={updateTechnicianStatus}
              onNavigate={navigateTo}
            />
          )}

          {role === 'admin' && renderAdminPanels()}
        </main>
      </div>

      {showResolvedModal && (
        <ResolvedModal
          ticket={selectedTicket}
          onClose={() => setShowResolvedModal(false)}
          onSubmitFeedback={submitFeedback}
          onPersistFailure={persistFailure}
        />
      )}

      {showCreateModal && (
        <CreateTicketModal
          catalog={catalog}
          onClose={() => setShowCreateModal(false)}
          onSubmit={createTicket}
        />
      )}

      {presenceRequest && (
        <PresenceReasonModal
          status={presenceRequest}
          onClose={() => setPresenceRequest(null)}
          onConfirm={confirmPresence}
        />
      )}

      {criticalTicket && (
        <CriticalAlert
          ticket={criticalTicket}
          onClose={() => setCriticalTicket(null)}
          onAccept={() => handleTechnicianAction(criticalTicket.id, 'start')}
        />
      )}

      {toast && <div className="app-toast-message">{toast}</div>}
    </div>
  );
}

export default App;
