import { useTheme } from '../../context/ThemeContext';
import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { NOTIFICATIONS_API_URL } from '../../config/api';

function Topbar({ role, activePanel, currentUser, onLogout, techStatus, setTechStatus, pushEnabled, onEnablePush, tickets = [] }) {
  const { theme, toggleTheme } = useTheme();
  
  // Obtener usuario del localStorage para contrastar si las props vienen vacías
  const storedUserRaw = localStorage.getItem('helpdesk_x_user');
  let localUser = null;
  try {
    if (storedUserRaw) localUser = JSON.parse(storedUserRaw);
  } catch (e) {
    console.error("Error al parsear helpdesk_x_user", e);
  }

  // Normalización segura de roles para compatibilidad (tecnico -> tech)
  const currentRole = role || currentUser?.role || localUser?.role || '';
  const normalizedRole = String(currentRole).toLowerCase() === 'tecnico' ? 'tech' : String(currentRole).toLowerCase();

  // Estados para las notificaciones reales del backend
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const adminTitles = { dashboard: 'Dashboard Principal', tickets: 'Tickets generales', technicians: 'Técnicos', associates: 'Usuarios', reports: 'Reportes' };
  const techTitles = { dashboard: 'Mi Dashboard', myTickets: 'Mis Tickets', waiting: 'En Espera', planned: 'Planificadas', reports: 'Mis Reportes' };
  
  const title = normalizedRole === 'admin'
    ? adminTitles[activePanel] || 'Administración'
    : normalizedRole === 'tech'
      ? techTitles[activePanel] || 'Portal Técnico'
      : activePanel === 'dashboard' ? 'Inicio' : activePanel === 'myTickets' ? 'Mis Tickets' : 'Portal del Asociado';
      
  const subtitle = normalizedRole === 'admin'
    ? 'Resumen general del departamento de TI'
    : normalizedRole === 'tech'
      ? 'Resumen de tu actividad y tickets'
      : 'Consulta el estado de tus solicitudes de soporte técnico.';

  // Helper interno con la clave real del proyecto
  const getAuthHeaders = () => {
    const token = localStorage.getItem('helpdesk_x_token') || localStorage.getItem('token') || '';
    return { headers: { Authorization: `Bearer ${token}` } };
  };

  // Helper seguro para parsear el payload de la notificación (Objeto JSONB o String JSON)
  const parsePayload = (payload) => {
    if (!payload) return {};
    if (typeof payload === 'object') return payload;
    try {
      return JSON.parse(payload);
    } catch (e) {
      return {};
    }
  };

  // Función para obtener notificaciones con token real
  const fetchNotifications = () => {
    axios.get(NOTIFICATIONS_API_URL, getAuthHeaders())
      .then((response) => {
        if (response.data && response.data.success) {
          const list = response.data.notifications || [];
          setNotifications(list);
          const unread = list.filter(n => !n.read_at).length;
          setUnreadCount(unread);
        }
      })
      .catch((err) => {
        console.error('Error cargando notificaciones protegidas:', err);
      });
  };

  // Polling cada 20 segundos
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 20000);
    return () => clearInterval(interval);
  }, []);

  // Evento para cerrar menú al dar clic fuera
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Al abrir el panel se marcan como vistas (seen) enviando cabecera JWT válida
  const toggleDropdown = async () => {
    const targetState = !isOpen;
    setIsOpen(targetState);

    if (targetState) {
      const unseenNotifications = notifications.filter(n => !n.seen_at);
      if (unseenNotifications.length === 0) return;

      try {
        await Promise.all(
          unseenNotifications.map(n => 
            axios.post(`${NOTIFICATIONS_API_URL}/${n.id}/seen`, {}, getAuthHeaders()).catch(e => e)
          )
        );
        setNotifications(prev => prev.map(n => ({ ...n, seen_at: n.seen_at || new Date().toISOString() })));
      } catch (error) {
        console.error('Error al marcar vistas:', error);
      }
    }
  };

  // Al hacer clic en un elemento se marca como leída (read) enviando cabecera JWT válida
  const handleNotificationClick = async (notif) => {
    if (!notif.read_at) {
      try {
        await axios.post(`${NOTIFICATIONS_API_URL}/${notif.id}/read`, {}, getAuthHeaders());
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read_at: new Date().toISOString() } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (error) {
        console.error('Error al marcar leída:', error);
      }
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-copy">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="topbar-actions">
        <button className="theme-toggle" type="button" onClick={toggleTheme} title={`Cambiar a modo ${theme === 'dark' ? 'claro' : 'oscuro'}`}>
          <span className="theme-kicker">Tema</span>
          <span className="theme-icon" aria-hidden="true">{theme === 'dark' ? '🌙' : '☀️'}</span>
          <span>{theme === 'dark' ? 'Oscuro' : 'Claro'}</span>
        </button>
        
        {normalizedRole === 'tech' && (
          <label className="status-select">
            Estado:
            <select value={techStatus} onChange={(e) => setTechStatus(e.target.value)}>
              <option>Activo</option>
              <option>En Break</option>
              <option>Fuera de Servicio</option>
            </select>
          </label>
        )}
        
        {normalizedRole === 'tech' && (
          pushEnabled
            ? <button className="push-enable push-enabled" type="button" disabled>✓ Alertas activas</button>
            : <button className="push-enable" type="button" onClick={onEnablePush}>Activar alertas</button>
        )}

        {normalizedRole === 'admin' && <button className="date-pill">↻ 13/06/2026 - 19/06/2026 📅</button>}

        <div className="bell-container" ref={dropdownRef}>
          <button className="bell" type="button" onClick={toggleDropdown}>
            🔔{unreadCount > 0 && <span>{unreadCount}</span>}
          </button>
          
          {isOpen && (
            <div className="notifications-dropdown panel">
              <div className="dropdown-header">
                <h3>Notificaciones ({unreadCount} pendientes)</h3>
              </div>
              <div className="dropdown-body">
                {notifications.length === 0 ? (
                  <div className="empty-dropdown">No tienes notificaciones nuevas</div>
                ) : (
                  notifications.map((notif) => {
                    const parsedPayload = parsePayload(notif.payload);
                    return (
                      <div 
                        key={notif.id} 
                        className={`dropdown-item ${notif.severity || 'info'} ${!notif.read_at ? 'unread' : ''}`}
                        onClick={() => handleNotificationClick(notif)}
                      >
                        <div className="dropdown-item-meta">
                          <strong className="dropdown-title">{notif.title}</strong>
                          {parsedPayload?.prioridad && (
                            <span className={`prio-badge ${parsedPayload.prioridad.toLowerCase()}`}>
                              {parsedPayload.prioridad}
                            </span>
                          )}
                        </div>
                        <p className="dropdown-body-text">{notif.body}</p>
                        <span className="dropdown-time">
                          {new Date(notif.created_at).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div className="session-pill">
          <span>Rol activo</span>
          <strong>{currentUser?.roleLabel || localUser?.roleLabel || (normalizedRole === 'tech' ? 'Técnico de Soporte' : normalizedRole === 'admin' ? 'Administrador TI' : 'Asociado')}</strong>
        </div>

        <div className="profile-chip">
          <div className="avatar">{currentUser?.avatar || localUser?.avatar || '👤'}</div>
          <div>
            <strong>{currentUser?.name || localUser?.name || 'Usuario'}</strong>
            <span>{currentUser?.department || localUser?.department || 'HelpDesk_X'}</span>
          </div>
          <button className="logout-btn" type="button" onClick={onLogout}>Salir</button>
        </div>
      </div>
    </header>
  );
}

export default Topbar;
