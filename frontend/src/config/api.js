// Configuración central de la URL del backend.
//
// En desarrollo local usa http://localhost:5000 por defecto.
// En producción (Render), define la variable de entorno REACT_APP_API_URL
// con la URL pública de tu Web Service del backend, por ejemplo:
//   REACT_APP_API_URL=https://nextgen-helpdesk-backend.onrender.com
//
// IMPORTANT: Create React App solo lee variables que empiecen con REACT_APP_
// y las incrusta en el build en tiempo de compilación. Si cambias esta
// variable en Render, necesitas volver a desplegar (rebuild) el sitio estático.

export const BASE_URL = (process.env.REACT_APP_API_URL || 'http://localhost:5000').replace(/\/$/, '');

export const API_URL = `${BASE_URL}/api/tickets`;
export const AUTH_API_URL = `${BASE_URL}/api/auth`;
export const TECHNICIAN_API_URL = `${BASE_URL}/api/technician`;
export const PRESENCE_API_URL = `${BASE_URL}/api/presence`;
export const ADMIN_API_URL = `${BASE_URL}/api/admin`;
export const REPORTS_API_URL = `${BASE_URL}/api/reports`;
export const NOTIFICATIONS_API_URL = `${BASE_URL}/api/notifications`;
export const CHAT_API_URL = `${BASE_URL}/api/chat`;
export const PUSH_API_URL = `${BASE_URL}/api/push`;
export const AUDIT_API_URL = `${BASE_URL}/api/admin/audit`;
