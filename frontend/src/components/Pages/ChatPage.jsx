import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import PageHeader from './PageHeader';
import { CHAT_API_URL, ADMIN_API_URL } from '../../config/api';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRole(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function getUserLabel(user) {
  return user?.full_name || user?.name || user?.username || `Usuario #${user?.id || ''}`;
}

function getRoleLabel(role) {
  const value = normalizeRole(role);

  if (value === 'admin' || value.includes('administrador')) return 'Administrador';
  if (value === 'tech' || value === 'tecnico' || value.includes('soporte')) return 'Técnico';
  if (value === 'associate' || value === 'asociado') return 'Asociado';

  return role || 'Usuario';
}

function formatDateTime(value) {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('es-NI', {
    timeZone: 'America/Managua',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function ChatPage({ authToken, currentUser, role }) {
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);

  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [savingMember, setSavingMember] = useState(false);

  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({
    name: '',
    description: '',
  });

  const [selectedUserId, setSelectedUserId] = useState('');

  const normalizedCurrentRole = normalizeRole(
    role ||
      currentUser?.role ||
      currentUser?.database_role ||
      currentUser?.role_label ||
      currentUser?.roleLabel
  );

  const isAdmin =
    normalizedCurrentRole === 'admin' ||
    normalizedCurrentRole === 'administrador' ||
    normalizedCurrentRole === 'administrador ti' ||
    normalizedCurrentRole.includes('admin');

  const headers = useMemo(() => ({
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  }), [authToken]);

  const selectedGroup = groups.find((group) => String(group.id) === String(selectedGroupId)) || null;

  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 3200);
  };

  const getErrorMessage = (requestError, fallback) => {
    return (
      requestError?.response?.data?.error ||
      requestError?.response?.data?.message ||
      fallback
    );
  };

  const loadGroups = async () => {
    if (!authToken) return;

    setLoadingGroups(true);
    setError('');

    try {
      const response = await axios.get(`${CHAT_API_URL}/groups`, { headers });
      const rows = safeArray(response.data?.groups || response.data);

      setGroups(rows);

      setSelectedGroupId((current) => {
        if (current && rows.some((group) => String(group.id) === String(current))) {
          return current;
        }

        return rows[0]?.id || null;
      });
    } catch (requestError) {
      setGroups([]);
      setSelectedGroupId(null);
      setError(getErrorMessage(requestError, 'No se pudieron cargar los grupos de chat.'));
    } finally {
      setLoadingGroups(false);
    }
  };

  const loadMembers = async (groupId) => {
    if (!authToken || !groupId) {
      setMembers([]);
      return;
    }

    try {
      const response = await axios.get(`${CHAT_API_URL}/groups/${groupId}/members`, { headers });
      setMembers(safeArray(response.data?.members || response.data));
    } catch {
      setMembers([]);
    }
  };

  const loadMessages = async (groupId) => {
    if (!authToken || !groupId) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);

    try {
      const response = await axios.get(`${CHAT_API_URL}/groups/${groupId}/messages`, { headers });
      setMessages(safeArray(response.data?.messages || response.data));
    } catch (requestError) {
      setMessages([]);
      setError(getErrorMessage(requestError, 'No se pudieron cargar los mensajes del grupo.'));
    } finally {
      setLoadingMessages(false);
    }
  };

  const loadAvailableUsers = async () => {
    if (!authToken || !isAdmin) return;

    try {
      const response = await axios.get(`${ADMIN_API_URL}/users?active=true`, { headers });
      setAvailableUsers(safeArray(response.data?.users || response.data));
    } catch {
      setAvailableUsers([]);
    }
  };

  useEffect(() => {
    if (!authToken) return undefined;

    let cancelled = false;

    const loadInitialData = async () => {
      try {
        await loadGroups();

        if (isAdmin) {
          await loadAvailableUsers();
        }
      } catch {
        if (!cancelled) {
          setError('No se pudo inicializar el chat interno.');
        }
      }
    };

    loadInitialData();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, isAdmin]);

  useEffect(() => {
    if (!selectedGroupId) {
      setMembers([]);
      setMessages([]);
      return undefined;
    }

    let cancelled = false;

    const loadGroupData = async () => {
      try {
        await Promise.all([
          loadMembers(selectedGroupId),
          loadMessages(selectedGroupId),
        ]);
      } catch {
        if (!cancelled) {
          setError('No se pudo cargar la información del grupo.');
        }
      }
    };

    loadGroupData();

    const interval = setInterval(() => {
      loadMessages(selectedGroupId);
    }, 8000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId]);

  const createGroup = async () => {
    if (!isAdmin) return;

    const name = newGroup.name.trim();
    const description = newGroup.description.trim();

    if (!name) {
      setError('El nombre del grupo es obligatorio.');
      return;
    }

    setSavingGroup(true);
    setError('');

    try {
      const response = await axios.post(
        `${CHAT_API_URL}/groups`,
        { name, description },
        { headers }
      );

      const created = response.data?.group || response.data;

      setNewGroup({ name: '', description: '' });
      setShowCreateGroup(false);

      await loadGroups();

      if (created?.id) {
        setSelectedGroupId(created.id);
      }

      showToast('Grupo creado correctamente.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'No se pudo crear el grupo.'));
    } finally {
      setSavingGroup(false);
    }
  };

  const addMember = async () => {
    if (!isAdmin || !selectedGroupId || !selectedUserId) return;

    setSavingMember(true);
    setError('');

    try {
      await axios.post(
        `${CHAT_API_URL}/groups/${selectedGroupId}/members`,
        {
          user_id: Number(selectedUserId),
          userId: Number(selectedUserId),
        },
        { headers }
      );

      setSelectedUserId('');
      await loadMembers(selectedGroupId);
      showToast('Miembro agregado correctamente.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'No se pudo agregar el miembro.'));
    } finally {
      setSavingMember(false);
    }
  };

  const removeMember = async (userId) => {
    if (!isAdmin || !selectedGroupId || !userId) return;

    setSavingMember(true);
    setError('');

    try {
      await axios.delete(`${CHAT_API_URL}/groups/${selectedGroupId}/members/${userId}`, { headers });
      await loadMembers(selectedGroupId);
      showToast('Miembro removido del grupo.');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'No se pudo remover el miembro.'));
    } finally {
      setSavingMember(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedGroupId || !message.trim()) return;

    const text = message.trim();

    if (text.length > 2000) {
      setError('El mensaje no puede superar los 2000 caracteres.');
      return;
    }

    setSending(true);
    setError('');

    try {
      await axios.post(
        `${CHAT_API_URL}/groups/${selectedGroupId}/messages`,
        {
          message: text,
          mensaje: text,
        },
        { headers }
      );

      setMessage('');
      await loadMessages(selectedGroupId);
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'No se pudo enviar el mensaje.'));
    } finally {
      setSending(false);
    }
  };

  const usersNotInGroup = availableUsers.filter((user) => {
    return !members.some((member) => {
      const memberId = member.user_id || member.userId || member.id;
      return String(memberId) === String(user.id);
    });
  });

  return (
    <section className="module-page chat-groups-page">
      {toast && <div className="module-toast">● {toast}</div>}

      <PageHeader
        title="Chat Interno"
        subtitle={
          isAdmin
            ? 'Administra grupos internos y agrega usuarios según necesidad operativa.'
            : 'Comunicación interna por grupos asignados por administración.'
        }
        actionLabel={isAdmin ? '+ Nuevo grupo' : ''}
        onAction={isAdmin ? () => setShowCreateGroup((current) => !current) : undefined}
      />

      {error && <div className="chat-alert error">⚠ {error}</div>}

      {showCreateGroup && isAdmin && (
        <div className="panel chat-create-group">
          <h3>Crear grupo</h3>
          <p>Solo administración puede crear grupos y agregar miembros.</p>

          <div className="chat-create-grid">
            <label>
              Nombre del grupo
              <input
                value={newGroup.name}
                onChange={(event) => setNewGroup((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ej. Soporte Redes"
              />
            </label>

            <label>
              Descripción
              <input
                value={newGroup.description}
                onChange={(event) => setNewGroup((current) => ({ ...current, description: event.target.value }))}
                placeholder="Objetivo del grupo"
              />
            </label>
          </div>

          <div className="chat-actions">
            <button className="primary-gradient-btn" type="button" onClick={createGroup} disabled={savingGroup}>
              {savingGroup ? 'Creando...' : 'Crear grupo'}
            </button>

            <button className="secondary-btn" type="button" onClick={() => setShowCreateGroup(false)} disabled={savingGroup}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="chat-groups-layout">
        <aside className="panel chat-groups-sidebar">
          <div className="chat-section-head">
            <div>
              <h3>{isAdmin ? 'Todos los grupos' : 'Mis grupos'}</h3>
              <p>{loadingGroups ? 'Cargando...' : `${groups.length} grupos disponibles`}</p>
            </div>

            <button className="secondary-btn small" type="button" onClick={loadGroups}>
              Refrescar
            </button>
          </div>

          <div className="chat-group-list">
            {!loadingGroups && groups.length === 0 && (
              <div className="chat-empty">
                <strong>
                  {isAdmin ? 'No hay grupos creados.' : 'No tienes grupos de chat asignados.'}
                </strong>
                <p>
                  {isAdmin
                    ? 'Crea un grupo para iniciar la comunicación interna.'
                    : 'Cuando administración te agregue a un grupo, aparecerá aquí.'}
                </p>
              </div>
            )}

            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={`chat-group-item ${String(selectedGroupId) === String(group.id) ? 'active' : ''}`}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <strong>{group.name || group.nombre || `Grupo #${group.id}`}</strong>
                <span>{group.description || group.descripcion || 'Sin descripción'}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="panel chat-thread-panel">
          {!selectedGroup ? (
            <div className="chat-empty large">
              <strong>Selecciona un grupo</strong>
              <p>Los mensajes aparecerán cuando elijas un grupo de la lista.</p>
            </div>
          ) : (
            <>
              <div className="chat-thread-header">
                <div>
                  <span className="chat-kicker">Grupo activo</span>
                  <h3>{selectedGroup.name || selectedGroup.nombre}</h3>
                  <p>{selectedGroup.description || selectedGroup.descripcion || 'Sin descripción'}</p>
                </div>

                <span className="chat-member-count">{members.length} miembros</span>
              </div>

              <div className="chat-messages">
                {loadingMessages && <p className="chat-muted">Cargando mensajes...</p>}

                {!loadingMessages && messages.length === 0 && (
                  <div className="chat-empty">
                    <strong>Sin mensajes todavía.</strong>
                    <p>Escribe el primer mensaje para iniciar la conversación.</p>
                  </div>
                )}

                {messages.map((item) => {
                  const mine = Number(item.sender_id || item.user_id) === Number(currentUser?.id);

                  return (
                    <article className={`chat-message ${mine ? 'mine' : ''}`} key={item.id}>
                      <div>
                        <strong>{item.sender_name || item.emisor_nombre || item.full_name || 'Usuario'}</strong>
                        <span>{formatDateTime(item.created_at)}</span>
                      </div>
                      <p>{item.message || item.mensaje}</p>
                    </article>
                  );
                })}
              </div>

              <div className="chat-compose group-chat-compose">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Escribe un mensaje para el grupo..."
                  maxLength={2000}
                  disabled={sending}
                />

                <div className="chat-compose-footer">
                  <span>{message.length}/2000</span>
                  <button className="primary-gradient-btn" type="button" onClick={sendMessage} disabled={sending || !message.trim()}>
                    {sending ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </div>
            </>
          )}
        </main>

        <aside className="panel chat-members-panel">
          <div className="chat-section-head">
            <div>
              <h3>Miembros</h3>
              <p>{selectedGroup ? `${members.length} usuarios en el grupo` : 'Selecciona un grupo'}</p>
            </div>
          </div>

          {selectedGroup && isAdmin && (
            <div className="chat-add-member">
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                disabled={savingMember}
              >
                <option value="">Agregar usuario...</option>
                {usersNotInGroup.map((user) => (
                  <option key={user.id} value={user.id}>
                    {getUserLabel(user)} · {getRoleLabel(user.role)}
                  </option>
                ))}
              </select>

              <button className="secondary-btn" type="button" onClick={addMember} disabled={savingMember || !selectedUserId}>
                Agregar
              </button>
            </div>
          )}

          <div className="chat-member-list">
            {!selectedGroup && (
              <div className="chat-empty">
                <p>Los miembros aparecerán aquí.</p>
              </div>
            )}

            {selectedGroup && members.length === 0 && (
              <div className="chat-empty">
                <p>Este grupo todavía no tiene miembros.</p>
              </div>
            )}

            {members.map((member) => {
              const userId = member.user_id || member.userId || member.id;

              return (
                <article className="chat-member-card" key={`${selectedGroupId}-${userId}`}>
                  <div>
                    <strong>{member.full_name || member.name || member.username || `Usuario #${userId}`}</strong>
                    <span>{member.username || getRoleLabel(member.role)}</span>
                  </div>

                  <em>{getRoleLabel(member.role)}</em>

                  {isAdmin && Number(userId) !== Number(currentUser?.id) && (
                    <button
                      type="button"
                      className="danger-mini-btn"
                      onClick={() => removeMember(userId)}
                      disabled={savingMember}
                    >
                      Quitar
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </aside>
      </div>
    </section>
  );
}

export default ChatPage;