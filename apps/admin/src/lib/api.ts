import { ApiClient, ApiError, type TokenStore } from '@lotok/shared';

let accessToken: string | null = null;
export const tokenStore: TokenStore = {
  getAccessToken: () => accessToken,
  getRefreshToken: () => null,
  setTokens: (a) => {
    accessToken = a?.accessToken ?? null;
  },
};

export const api = new ApiClient({ baseUrl: '/api/v1', tokens: tokenStore, credentials: 'include', headers: { 'X-Client-Platform': 'web' } });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'validation_error' && Array.isArray(e.details) && e.details.length) return (e.details as { path?: string; message: string }[]).map((d) => `${d.path ? `${d.path}: ` : ''}${d.message}`).join('; ');
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return 'Ошибка';
}

export { ApiError };
