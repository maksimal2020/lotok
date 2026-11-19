import { ApiClient, ApiError, type TokenStore } from '@lotok/shared';

/** Access-токен хранится только в памяти вкладки; refresh — в httpOnly cookie (недоступен JS). */
let accessToken: string | null = null;
const listeners = new Set<(t: string | null) => void>();

export const tokenStore: TokenStore = {
  getAccessToken: () => accessToken,
  getRefreshToken: () => null,
  setTokens: (auth) => {
    accessToken = auth?.accessToken ?? null;
    listeners.forEach((l) => l(accessToken));
  },
};

export function onTokenChange(fn: (t: string | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAccessToken() {
  return accessToken;
}

export const api = new ApiClient({
  baseUrl: '/api/v1',
  tokens: tokenStore,
  credentials: 'include',
  headers: { 'X-Client-Platform': 'web' },
});

/** Серверные запросы (SSR/SEO): напрямую во внутренний адрес API, без авторизации. */
export async function serverGet<T>(path: string, revalidate = 30): Promise<T | null> {
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${base}/api/v1${path}`, { next: { revalidate }, headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    console.error('serverGet failed', path, e);
    throw e;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'validation_error' && Array.isArray(e.details) && e.details.length) {
      return (e.details as { message: string }[]).map((d) => d.message).join('. ');
    }
    return e.message;
  }
  if (e instanceof TypeError) return 'Нет соединения с сервером. Проверьте интернет и попробуйте снова.';
  if (e instanceof Error && e.message) return e.message;
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

/** Ошибки валидации по полям: { 'attributes.brand': 'Укажите…' }. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (e instanceof ApiError && Array.isArray(e.details)) {
    return Object.fromEntries((e.details as { path: string; message: string }[]).filter((d) => d.path).map((d) => [d.path, d.message]));
  }
  return {};
}

export { ApiError };
