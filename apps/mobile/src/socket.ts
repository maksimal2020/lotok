import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './config';
import { api, onTokenChange, tokens } from './api';

let socket: Socket | null = null;

function connect(): Socket | null {
  if (!tokens.getAccessToken()) return null;
  if (socket) return socket;
  socket = io(API_URL, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: (cb) => cb({ token: tokens.getAccessToken() }),
    reconnectionDelayMax: 15000,
  });
  // Истёкший access-токен: обновляем и переподключаемся.
  socket.on('auth:error', async () => {
    if (await api.refresh()) socket?.connect();
  });
  return socket;
}

onTokenChange((t) => {
  if (!t && socket) {
    socket.disconnect();
    socket = null;
  }
});

export function useSocket() {
  const [s, setS] = useState<Socket | null>(() => connect());
  useEffect(() => onTokenChange(() => setS(connect())), []);
  return s;
}
