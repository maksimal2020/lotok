'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, type AuthResponse, type Me, type Permission } from '@lotok/shared';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { api, tokenStore } from './api';

interface AdminAuth {
  user: Me | null;
  ready: boolean;
  can(p: Permission): boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AdminAuth | null>(null);

export function AdminProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1 } } }),
  );
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!document.cookie.includes('lotok_csrf=')) return setReady(true);
    api
      .refresh()
      .then(async (ok) => ok && setUser(await api.get<Me>('/users/me')))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);
  const value: AdminAuth = {
    user,
    ready,
    can: (p) => !!user?.permissions.includes(p),
    async login(email, password) {
      const r = await api.post<AuthResponse>('/auth/login', { email, password, platform: 'web', deviceName: 'Админ-панель' });
      if (!r.user.roles.length) {
        await api.post('/auth/logout').catch(() => undefined);
        throw new Error('У этой учётной записи нет доступа к административной панели');
      }
      tokenStore.setTokens({ accessToken: r.accessToken });
      setUser(r.user);
    },
    async logout() {
      await api.post('/auth/logout').catch(() => undefined);
      tokenStore.setTokens(null);
      setUser(null);
    },
  };
  return (
    <QueryClientProvider client={client}>
      <Ctx.Provider value={value}>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </Ctx.Provider>
    </QueryClientProvider>
  );
}

export function useAdmin() {
  const v = useContext(Ctx);
  if (!v) throw new Error('no admin ctx');
  return v;
}
