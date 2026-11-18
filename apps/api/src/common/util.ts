import { createHash, randomBytes, randomInt } from 'node:crypto';

export const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const randomDigits = (n: number) =>
  Array.from({ length: n }, () => randomInt(0, 10)).join('');

export function paginate(page: number, limit: number) {
  return { limit, offset: (page - 1) * limit };
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Маскирование email/телефона для логов и публичных ответов. */
export function maskPhone(p: string) {
  return p.replace(/^(\+7)(\d{3})\d{4}(\d{3})$/, '$1 $2 ***-$3');
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Экранирование спецсимволов LIKE. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
