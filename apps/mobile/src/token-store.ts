import type { TokenStore } from '@lotok/shared';

export interface KeyValueStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const REFRESH_KEY = 'lotok.refresh';

/**
 * Хранилище токенов мобильного клиента: access — только в памяти, refresh — в защищённом хранилище ОС
 * (Keychain / Keystore через expo-secure-store). Хранилище внедряется для тестируемости.
 */
export function createTokenStore(storage: KeyValueStorage, onChange?: (access: string | null) => void): TokenStore & { clear(): Promise<void>; hasSession(): Promise<boolean> } {
  let access: string | null = null;
  return {
    getAccessToken: () => access,
    getRefreshToken: () => storage.getItemAsync(REFRESH_KEY),
    async setTokens(t) {
      access = t?.accessToken ?? null;
      if (!t) await storage.deleteItemAsync(REFRESH_KEY);
      else if (t.refreshToken) await storage.setItemAsync(REFRESH_KEY, t.refreshToken);
      onChange?.(access);
    },
    async clear() {
      access = null;
      await storage.deleteItemAsync(REFRESH_KEY);
      onChange?.(null);
    },
    async hasSession() {
      return !!(await storage.getItemAsync(REFRESH_KEY));
    },
  };
}
