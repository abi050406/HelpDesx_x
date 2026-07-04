import { io } from 'socket.io-client';
import { BASE_URL } from '../config/api';

export function createHelpdeskSocket(token) {
  return io(BASE_URL, { auth: { token }, transports: ['websocket', 'polling'] });
}
