'use client';

import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, onTokenChange } from './api';

let socket: Socket | null = null;

/**
 * Единственное WebSocket-соединение на вкладку. Socket.IO сам переподключается с экспоненциальной задержкой;
 * при отказе из-за истёкшего токена мы обновляем токен и переподключаемся.
 */
export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (socket) return socket;
  if (!getAccessToken()) return null;
  socket = io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
  });
  socket.on('auth:error', async () => {
    const ok = await api.refresh();
    if (ok) socket?.connect();
  });
  onTokenChange((t) => {
    if (!t) {
      socket?.disconnect();
      socket = null;
    }
  });
  return socket;
}
