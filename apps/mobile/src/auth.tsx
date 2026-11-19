import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { AuthResponse, Me } from '@lotok/shared';
import { api, tokens } from './api';

interface AuthCtx {
  user: Me | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; displayName: string }): Promise<void>;
  requestSms(phone: string): Promise<void>;
  verifySms(phone: string, code: string, acceptTerms: boolean): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

/** Регистрация push-токена Expo (на физическом устройстве, после разрешения пользователя). */
async function registerPush() {
  if (!Device.isDevice) return;
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  try {
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await api.post('/users/me/push-tokens', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  } catch {
    // Push необязателен: без projectId EAS токен не выдаётся.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const apply = useCallback(async (r: AuthResponse) => {
    await tokens.setTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    setUser(r.user);
    void registerPush();
  }, []);

  useEffect(() => {
    (async () => {
      if (await tokens.hasSession()) {
        const ok = await api.refresh();
        if (ok) setUser(await api.get<Me>('/users/me').catch(() => null));
      }
      setReady(true);
    })();
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      ready,
      async login(email, password) {
        await apply(await api.post<AuthResponse>('/auth/login', { email: email.trim().toLowerCase(), password, platform: Platform.OS, deviceName: Device.modelName ?? undefined }));
      },
      async register(input) {
        await apply(await api.post<AuthResponse>('/auth/register', { ...input, acceptTerms: true, acceptPersonalData: true }));
      },
      async requestSms(phone) {
        await api.post('/auth/phone/request', { phone });
      },
      async verifySms(phone, code, acceptTerms) {
        await apply(await api.post<AuthResponse>('/auth/phone/verify', { phone, code, acceptTerms: acceptTerms || undefined, platform: Platform.OS }));
      },
      async logout() {
        await api.post('/auth/logout').catch(() => undefined);
        await tokens.clear();
        setUser(null);
      },
      async reload() {
        setUser(await api.get<Me>('/users/me'));
      },
    }),
    [user, ready, apply],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
