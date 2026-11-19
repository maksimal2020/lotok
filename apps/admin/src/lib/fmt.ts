import { formatMoney } from '@lotok/shared';

export const rub = (m: number | null | undefined) => formatMoney(m ?? 0);
export const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const short = (id: string) => id.slice(0, 8);
