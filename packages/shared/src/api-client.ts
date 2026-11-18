import type { ApiErrorBody, AuthResponse } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface TokenStore {
  getAccessToken(): string | null | Promise<string | null>;
  setTokens(auth: { accessToken: string; refreshToken?: string } | null): void | Promise<void>;
  /** Мобильные клиенты возвращают refresh-токен; веб — null (используется httpOnly cookie). */
  getRefreshToken(): string | null | Promise<string | null>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens?: TokenStore;
  /** 'include' для веба (cookie refresh), 'omit' для мобильных. */
  credentials?: 'include' | 'omit' | 'same-origin';
  fetchImpl?: typeof fetch;
  onAuthFailure?: () => void;
  /** Заголовки, добавляемые к каждому запросу (например, X-Client-Platform). */
  headers?: Record<string, string>;
}

export type Query = Record<string, string | number | boolean | undefined | null | Array<string | number>>;

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','));
    } else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export class ApiClient {
  private refreshing: Promise<boolean> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  get baseUrl() {
    return this.opts.baseUrl;
  }

  async request<T>(method: string, path: string, init: { body?: unknown; query?: Query; auth?: boolean; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
    const doFetch = async () => {
      const headers: Record<string, string> = { Accept: 'application/json', ...(this.opts.headers ?? {}) };
      const token = this.opts.tokens ? await this.opts.tokens.getAccessToken() : null;
      if (token) headers.Authorization = `Bearer ${token}`;
      let body: BodyInit | undefined;
      if (init.form) body = init.form;
      else if (init.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(init.body);
      }
      return this.fetchImpl(`${this.opts.baseUrl}${path}${buildQuery(init.query)}`, {
        method,
        headers,
        body,
        credentials: this.opts.credentials ?? 'omit',
        signal: init.signal,
      });
    };

    let res = await doFetch();
    if (res.status === 401 && this.opts.tokens && !path.startsWith('/auth/')) {
      const ok = await this.refresh();
      if (ok) res = await doFetch();
      else this.opts.onAuthFailure?.();
    }
    return this.parse<T>(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const err = (data ?? {}) as Partial<ApiErrorBody>;
      throw new ApiError(res.status, err.code ?? 'http_error', err.message ?? `HTTP ${res.status}`, err.details);
    }
    return data as T;
  }

  /** Обновление access-токена. Параллельные вызовы объединяются в один запрос. */
  async refresh(): Promise<boolean> {
    if (!this.opts.tokens) return false;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const refreshToken = await this.opts.tokens!.getRefreshToken();
          const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(this.opts.headers ?? {}) };
          const csrf = readCookie('lotok_csrf');
          if (csrf) headers['X-CSRF-Token'] = csrf;
          const res = await this.fetchImpl(`${this.opts.baseUrl}/auth/refresh`, {
            method: 'POST',
            headers,
            body: JSON.stringify(refreshToken ? { refreshToken } : {}),
            credentials: this.opts.credentials ?? 'omit',
          });
          if (!res.ok) {
            await this.opts.tokens!.setTokens(null);
            return false;
          }
          const data = (await res.json()) as AuthResponse;
          await this.opts.tokens!.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
          return true;
        } catch {
          return false;
        } finally {
          setTimeout(() => (this.refreshing = null), 0);
        }
      })();
    }
    return this.refreshing;
  }

  get<T>(path: string, query?: Query, signal?: AbortSignal) {
    return this.request<T>('GET', path, { query, signal });
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, { body });
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, { body });
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, { body });
  }
  delete<T>(path: string, body?: unknown) {
    return this.request<T>('DELETE', path, { body });
  }
  upload<T>(path: string, form: FormData) {
    return this.request<T>('POST', path, { form });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/** Превращает плоский объект фильтров поиска в query-параметры (attr.<key>=…). */
export function searchToQuery(q: Record<string, unknown>): Query {
  const out: Query = {};
  for (const [k, v] of Object.entries(q)) {
    if (k === 'attrs' && v && typeof v === 'object') {
      for (const [ak, av] of Object.entries(v as Record<string, string>)) out[`attr.${ak}`] = av;
    } else if (v !== undefined && v !== null && v !== '') out[k] = v as string;
  }
  return out;
}
