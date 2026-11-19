import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { ApiClient, ApiError } from '@lotok/shared';
import { API_URL } from './config';
import { createTokenStore } from './token-store';

type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();
export const onTokenChange = (l: Listener) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const tokens = createTokenStore(SecureStore, (t) => listeners.forEach((l) => l(t)));

/** Общий API-клиент из @lotok/shared: те же контракты и бизнес-правила, что и у веба. */
export const api = new ApiClient({
  baseUrl: `${API_URL}/api/v1`,
  tokens,
  credentials: 'omit',
  headers: { 'X-Client-Platform': Platform.OS === 'ios' ? 'ios' : 'android' },
});

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'validation_error' && Array.isArray(e.details) && e.details.length) return (e.details as { message: string }[]).map((d) => d.message).join('. ');
    return e.message;
  }
  if (e instanceof TypeError) return 'Нет соединения с сервером';
  return e instanceof Error ? e.message : 'Ошибка';
}

export { ApiError };
