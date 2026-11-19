'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AuthResponse, Me } from '@lotok/shared';
import { api, tokenStore } from './api';

interface AuthState {
  user: Me | null;
  ready: boolean;
  login(email: string, password: string): Promise<Me>;
  register(input: { email: string; password: string; displayName: string; acceptTerms: true; acceptPersonalData: true }): Promise<Me>;
  applyAuth(r: AuthResponse): void;
  logout(all?: boolean): Promise<void>;
  reload(): Promise<void>;
  setUser(u: Me | null): void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Восстановление сессии по httpOnly cookie (маркер — читаемая CSRF-cookie, выставляемая вместе с ней).
    if (!document.cookie.includes('lotok_csrf=')) {
      setReady(true);
      return;
    }
    api
      .refresh()
      .then(async (ok) => {
        if (ok) setUser(await api.get<Me>('/users/me'));
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const applyAuth = useCallback((r: AuthResponse) => {
    tokenStore.setTokens({ accessToken: r.accessToken });
    setUser(r.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      applyAuth,
      async login(email, password) {
        const r = await api.post<AuthResponse>('/auth/login', { email, password, platform: 'web' });
        applyAuth(r);
        return r.user;
      },
      async register(input) {
        const r = await api.post<AuthResponse>('/auth/register', input);
        applyAuth(r);
        return r.user;
      },
      async logout(all = false) {
        await api.post(all ? '/auth/logout-all' : '/auth/logout').catch(() => undefined);
        tokenStore.setTokens(null);
        setUser(null);
      },
      async reload() {
        setUser(await api.get<Me>('/users/me'));
      },
      setUser,
    }),
    [user, ready, applyAuth],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** Страницы личного кабинета: без входа — переход на страницу авторизации с возвратом. */
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (auth.ready && !auth.user) router.replace(`/auth/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.ready, auth.user, router, pathname]);
  return auth;
}
