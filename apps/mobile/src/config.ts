import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Адрес API. Порядок: EXPO_PUBLIC_API_URL (сборки EAS) → app.json extra.apiUrl.
 * В эмуляторе Android «localhost» хоста доступен как 10.0.2.2.
 */
export function resolveApiUrl(raw: string, platform: string, isDevice: boolean): string {
  const url = raw.replace(/\/$/, '');
  if (platform === 'android' && !isDevice) return url.replace('://localhost', '://10.0.2.2').replace('://127.0.0.1', '://10.0.2.2');
  return url;
}

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; webUrl?: string };

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? 'http://localhost:4000', Platform.OS, Constants.isDevice ?? false);
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? extra.webUrl ?? API_URL).replace(/\/$/, '');
