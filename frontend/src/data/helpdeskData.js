export {
  API_URL,
  AUTH_API_URL,
  TECHNICIAN_API_URL,
  PRESENCE_API_URL,
  ADMIN_API_URL,
} from '../config/api';

export const ticketCategories = {
  Software: {
    slaMinutes: 60,
    tags: ['Aplicación caída', 'Error de acceso', 'Instalación', 'Rendimiento'],
    questions: [
      { id: 'scope', label: '¿A cuántas personas afecta?', options: [['Solo a mí', 0], ['A un equipo', 2], ['A toda la empresa', 4]] },
      { id: 'workaround', label: '¿Existe una alternativa temporal?', options: [['Sí', 0], ['Parcial', 1], ['No', 3]] },
      { id: 'business', label: '¿Detiene un proceso crítico del negocio?', options: [['No', 0], ['Lo ralentiza', 2], ['Lo detiene', 4]] },
    ],
  },
  Hardware: {
    slaMinutes: 120,
    tags: ['Equipo no enciende', 'Impresora', 'Periférico', 'Daño físico'],
    questions: [
      { id: 'scope', label: '¿A cuántos puestos afecta?', options: [['Un puesto', 0], ['Varios puestos', 2], ['Área completa', 4]] },
      { id: 'replacement', label: '¿Hay equipo de reemplazo disponible?', options: [['Sí', 0], ['Limitado', 1], ['No', 3]] },
      { id: 'safety', label: '¿Hay riesgo eléctrico, humo o sobrecalentamiento?', options: [['No', 0], ['Posible', 2], ['Sí', 5]] },
    ],
  },
  Redes: {
    slaMinutes: 45,
    tags: ['Sin Internet', 'VPN caída', 'Wi-Fi', 'Servidor inaccesible'],
    questions: [
      { id: 'scope', label: '¿Qué alcance tiene la interrupción?', options: [['Un dispositivo', 0], ['Un área', 3], ['Toda la sede', 5]] },
      { id: 'connectivity', label: '¿La conexión está totalmente interrumpida?', options: [['No', 0], ['Intermitente', 2], ['Sí', 4]] },
      { id: 'business', label: '¿Afecta facturación u otro servicio crítico?', options: [['No', 0], ['Parcialmente', 2], ['Sí', 4]] },
    ],
  },
};

export function calculateTicketPriority(category, answers = {}) {
  const questions = ticketCategories[category]?.questions || [];
  const score = questions.reduce((total, question) => total + Number(answers[question.id] || 0), 0);

  if (score >= 10) return { priority: 'Crítica', score };
  if (score >= 7) return { priority: 'Alta', score };
  if (score >= 3) return { priority: 'Media', score };
  return { priority: 'Baja', score };
}

export const demoUsers = [
  {
    id: 1,
    username: 'bryan.mercado',
    password: 'Plano2026*',
    name: 'Bryan Mercado',
    role: 'admin',
    roleLabel: 'Administrador TI',
    department: 'TI',
    avatar: '👨‍💻',
  },
  {
    id: 2,
    username: 'juan.perez',
    password: 'Tech2026*',
    name: 'Juan Pérez',
    role: 'tech',
    roleLabel: 'Técnico de Soporte',
    department: 'TI',
    avatar: '👨',
  },
  {
    id: 3,
    username: 'roberto.sequeira',
    password: 'Tech2026*',
    name: 'Roberto Sequeira',
    role: 'tech',
    roleLabel: 'Técnico de Soporte',
    department: 'TI',
    avatar: '👨‍🔧',
  },
  {
    id: 4,
    username: 'ana.lopez',
    password: 'Asociado2026*',
    name: 'Ana López',
    role: 'associate',
    roleLabel: 'Asociado',
    department: 'Contabilidad',
    avatar: '👩',
  },
];

export const fallbackTickets = [
  {
    id: 1245,
    titulo: 'Plataforma de facturación caída',
    descripcion: 'No se puede acceder al módulo de facturación desde las 9am. Error 500 en el servidor.',
    estado: 'en proceso',
    prioridad: 'critica',
    categoria: 'Software',
    solicitante: 'Ana López',
    tecnico: 'Juan Pérez',
    hora: '10:15',
    fecha: '19/06/2026',
  },
  {
    id: 1246,
    titulo: 'Error al imprimir documentos',
    descripcion: 'La impresora de recepción muestra error 0x00000709',
    estado: 'abierto',
    prioridad: 'alta',
    categoria: 'Hardware',
    solicitante: 'María González',
    tecnico: 'María G.',
    hora: '09:58',
    fecha: '19/06/2026',
  },
  {
    id: 1243,
    titulo: 'Instalación de software',
    descripcion: 'Requiere instalación de Adobe Reader en 5 equipos',
    estado: 'en espera',
    prioridad: 'media',
    categoria: 'Software',
    solicitante: 'Pedro Ramírez',
    tecnico: 'Luis Andrade',
    hora: 'Ayer',
    fecha: '18/06/2026',
  },
  {
    id: 1242,
    titulo: 'Acceso compartido',
    descripcion: 'Solicitud de acceso a carpeta compartida',
    estado: 'resuelto',
    prioridad: 'baja',
    categoria: 'Accesos',
    solicitante: 'Carla Ramírez',
    tecnico: 'Carla R.',
    hora: 'Ayer',
    fecha: '18/06/2026',
  },
  {
    id: 1247,
    titulo: 'Solicitud de acceso VPN',
    descripcion: 'Usuario nuevo requiere acceso a VPN corporativa',
    estado: 'planificado',
    prioridad: 'media',
    categoria: 'Redes',
    solicitante: 'Carlos Rivera',
    tecnico: 'Juan Pérez',
    hora: '12 min',
    fecha: '19/06/2026',
  },
];

export const menuByRole = {
  admin: [
    { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
    { id: 'tickets', label: 'Tickets', icon: '▣', badge: 12 },
    { id: 'associates', label: 'Usuarios', icon: '♧' },
    { id: 'technicians', label: 'Técnicos', icon: '♙' },
    { id: 'categories', label: 'Categorías', icon: '▦' },
    { id: 'reports', label: 'Reportes e Informes', icon: '◫' },
    { id: 'wiki', label: 'Base de Conocimiento', icon: '▧' },
    { id: 'audit', label: 'Bitácora del Sistema', icon: '◌' },
    { id: 'chat', label: 'Chat Interno', icon: '☏' },
    { id: 'ratings', label: 'Calificaciones', icon: '★' },
    { id: 'settings', label: 'Configuración', icon: '⚙' },
    { id: 'logout', label: 'Cerrar Sesión', icon: '↩' },
  ],

  tech: [
    { id: 'dashboard', label: 'Mi Dashboard', icon: '⌂' },
    { id: 'myTickets', label: 'Mis Tickets', icon: '▣', badge: 8 },
    { id: 'waiting', label: 'En Espera', icon: '◷', badge: 2 },
    { id: 'planned', label: 'Planificadas', icon: '▣', badge: 1 },
    { id: 'wiki', label: 'Base de Conocimiento', icon: '▧' },
    { id: 'chat', label: 'Chat Interno', icon: '☏' },
    { id: 'reports', label: 'Reportes', icon: '◫' },
    { id: 'profile', label: 'Mi Perfil', icon: '♙' },
    { id: 'logout', label: 'Cerrar Sesión', icon: '↩' },
  ],

  associate: [
    { id: 'dashboard', label: 'Inicio', icon: '⌂' },
    { id: 'myTickets', label: 'Mis Tickets', icon: '▣' },
    { id: 'wiki', label: 'Base de Conocimiento', icon: '▧' },
    { id: 'news', label: 'Noticias y Avisos', icon: '◫' },
    { id: 'profile', label: 'Mi Perfil', icon: '♙' },
    { id: 'logout', label: 'Cerrar Sesión', icon: '↩' },
  ],
};
export const technicians = [
  { name: 'María González', state: 'Activo', tickets: 3 },
  { name: 'Juan Pérez', state: 'Ocupado', tickets: 5 },
  { name: 'Luis Andrade', state: 'En Break', tickets: 1 },
  { name: 'Carla Ramírez', state: 'Activo', tickets: 2 },
];

export const associates = [
  { name: 'Ana López', department: 'Contabilidad', open: 1, satisfaction: 4.8 },
  { name: 'María González', department: 'Finanzas', open: 1, satisfaction: 4.6 },
  { name: 'Pedro Ramírez', department: 'Operaciones', open: 1, satisfaction: 4.2 },
  { name: 'Carla Ramírez', department: 'RRHH', open: 0, satisfaction: 5.0 },
];

export const categories = [
  { name: 'Software', sla: '1h', active: true },
  { name: 'Hardware', sla: '2h', active: true },
  { name: 'Redes', sla: '45m', active: true },
  { name: 'Accesos', sla: '30m', active: true },
  { name: 'Otros', sla: '4h', active: true },
];

export const notifications = [
  { type: 'danger', title: 'Ticket Crítico Asignado', text: '#001245 · Plataforma caída', time: 'Hace 2 min' },
  { type: 'warning', title: 'Nuevo Ticket de Alta Prioridad', text: '#001246 · Error en impresión', time: 'Hace 5 min' },
  { type: 'success', title: 'Ticket Resuelto', text: '#001244 · Acceso a sistema', time: 'Hace 10 min' },
  { type: 'info', title: 'Nuevo Ticket', text: '#001247 · Solicitud de acceso', time: 'Hace 12 min' },
];

export const wikiArticles = [
  { title: 'Restablecer acceso a VPN corporativa', category: 'Redes', updated: 'Hoy' },
  { title: 'Error 0x00000709 en impresoras Windows', category: 'Hardware', updated: 'Ayer' },
  { title: 'Procedimiento de alta de usuarios internos', category: 'Accesos', updated: '17/06/2026' },
];

function parseDateSafe(value) {
  if (!value) return null;

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const match = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(.+))?$/);
  if (match) {
    const [, day, month, year] = match;
    const parsedFromSlash = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00`);
    if (!Number.isNaN(parsedFromSlash.getTime())) return parsedFromSlash;
  }

  return null;
}

function formatDateNI(value) {
  const parsed = parseDateSafe(value);
  if (!parsed) return '';

  return parsed.toLocaleDateString('es-NI', {
    timeZone: 'America/Managua',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatTimeNI(value) {
  const parsed = parseDateSafe(value);
  if (!parsed) return '';

  return parsed.toLocaleTimeString('es-NI', {
    timeZone: 'America/Managua',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateTimeNI(value) {
  const parsed = parseDateSafe(value);
  if (!parsed) return '';

  return parsed.toLocaleString('es-NI', {
    timeZone: 'America/Managua',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function normalizeTicket(ticket) {
  const estado = String(ticket.estado || ticket.status || 'abierto').toLowerCase();
  const prioridad = String(ticket.prioridad || ticket.priority || 'media').toLowerCase();

  const createdAt =
    ticket.t_apertura ||
    ticket.created_at ||
    ticket.createdAt ||
    ticket.fecha_creacion ||
    ticket.fecha_apertura ||
    ticket.created_on ||
    null;

  const updatedAt =
    ticket.updated_at ||
    ticket.updatedAt ||
    ticket.fecha_actualizacion ||
    ticket.fecha_update ||
    createdAt ||
    null;

  const plannedAt =
    ticket.fecha_planificada ||
    ticket.planned_at ||
    ticket.plannedAt ||
    ticket.scheduledAt ||
    ticket.scheduled_at ||
    null;

  const rawDateForDisplay = createdAt || updatedAt;

  return {
    ...ticket,

    id: ticket.id || ticket.ticket_id || Math.random().toString(16).slice(2),

    titulo: ticket.titulo || ticket.title || 'Ticket sin título',
    titulo_tecnico: ticket.titulo_tecnico || ticket.technical_title || ticket.titulo || ticket.title || 'Ticket sin título',

    descripcion: ticket.descripcion || ticket.description || 'Sin descripción registrada.',
    descripcion_breve: ticket.descripcion_breve || ticket.short_description || ticket.descripcion || ticket.description || 'Sin descripción registrada.',

    estado,
    prioridad,

    categoria: ticket.categoria || ticket.category || 'Software',

    solicitante:
      ticket.solicitante ||
      ticket.solicitante_nombre ||
      ticket.usuario_nombre ||
      ticket.usuario ||
      ticket.user_name ||
      'Asociado',

    tecnico:
      ticket.tecnico ||
      ticket.tecnico_nombre ||
      ticket.assigned_to ||
      'Sin asignar',

    tecnico_id: ticket.tecnico_id || ticket.technician_id || null,
    usuario_id: ticket.usuario_id || ticket.user_id || null,

    t_apertura: createdAt,
    created_at: createdAt,
    createdAt,

    updated_at: updatedAt,
    updatedAt,

    fecha: ticket.fecha || formatDateNI(rawDateForDisplay),
    hora: ticket.hora || formatTimeNI(rawDateForDisplay),

    fecha_planificada: plannedAt,
    planned_at: plannedAt,
    plannedAt,
    scheduledAt: plannedAt,
    fecha_planificada_label: plannedAt ? formatDateTimeNI(plannedAt) : '',

    duracion_neta_segundos: Number(ticket.duracion_neta_segundos || 0),
    sla_objetivo_minutos: Number(ticket.sla_objetivo_minutos || 0),

    ratings: ticket.ratings || [],
    legacyRatings: ticket.legacyRatings || ticket.legacy_ratings || [],

    diagnostico: ticket.diagnostico || ticket.ticket_diagnostico || ticket.diagnostic || ticket.diagnostics || null,
    respuestas_contexto: ticket.respuestas_contexto || ticket.respuestas || ticket.context_answers || null,
    puntaje_prioridad: ticket.puntaje_prioridad || ticket.priority_score || null,

    pendingAssociateRating: ticket.pendingAssociateRating ?? ticket.pending_associate_rating,
    pendingTechnicianRating: ticket.pendingTechnicianRating ?? ticket.pending_technician_rating,

    assignment_status: ticket.assignment_status || ticket.estado_asignacion || (ticket.tecnico_id || ticket.tecnico_nombre ? 'assigned' : 'waiting_pool'),
    assignment_reason: ticket.assignment_reason || ticket.motivo_asignacion || ticket.reason_code || null,
    assignment_reason_message: ticket.assignment_reason_message || ticket.assignment_message || ticket.motivo_asignacion_texto || ticket.assignment_reason || null,
    assignment_method: ticket.assignment_method || ticket.metodo_asignacion || (ticket.assigned_by_admin ? 'Manual' : 'Automática'),
    assignment_metadata: ticket.assignment_metadata || ticket.metadata_asignacion || ticket.assignment || null,
    skipped_candidates: ticket.skipped_candidates || ticket.candidatos_omitidos || ticket.assignment_metadata?.skipped_candidates || [],
    selected_technician_id: ticket.selected_technician_id || ticket.assignment_metadata?.selected_technician_id || ticket.tecnico_id || null,
    selected_technician_name: ticket.selected_technician_name || ticket.assignment_metadata?.selected_technician_name || ticket.tecnico_nombre || ticket.tecnico || null,
    active_load: ticket.active_load ?? ticket.assignment_metadata?.active_load ?? null,
    max_active_tickets: ticket.max_active_tickets ?? ticket.assignment_metadata?.max_active_tickets ?? null,
  };
}

export function countByState(tickets, search) {
  return tickets.filter((ticket) => String(ticket.estado || '').includes(search)).length;
}

export function priorityLabel(value) {
  const key = String(value || '').toLowerCase();
  if (key.includes('crit')) return 'Crítica';
  if (key.includes('alt')) return 'Alta';
  if (key.includes('baj')) return 'Baja';
  return 'Media';
}

export function statusLabel(value) {
  const key = String(value || '').toLowerCase();
  if (key.includes('resuelto')) return 'Resuelto';
  if (key.includes('proceso') || key.includes('progreso')) return 'En Progreso';
  if (key.includes('espera')) return 'En Espera';
  if (key.includes('plan')) return 'Planificado';
  if (key.includes('cerr')) return 'Cerrado';
  return 'Abierto';
}