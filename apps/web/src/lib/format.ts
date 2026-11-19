import { formatMoney, LABELS, pluralRu, type ListingCard } from '@lotok/shared';

export function priceLabel(l: Pick<ListingCard, 'price' | 'priceType'>): string {
  if (l.priceType === 'free') return 'Даром';
  if (l.priceType === 'on_request' || l.price === null) return 'Цена по запросу';
  return formatMoney(l.price);
}

export function rub(minor: number | null | undefined) {
  return formatMoney(minor ?? 0);
}

const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
const df = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dtf = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const tf = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMin = Math.round((d.getTime() - Date.now()) / 60000);
  if (Math.abs(diffMin) < 60) return diffMin === 0 ? 'только что' : rtf.format(diffMin, 'minute');
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 24) return rtf.format(diffH, 'hour');
  const diffD = Math.round(diffH / 24);
  if (Math.abs(diffD) < 7) return rtf.format(diffD, 'day');
  return df.format(d);
}

export const dateTime = (iso: string) => dtf.format(new Date(iso));
export const time = (iso: string) => tf.format(new Date(iso));

export function count(n: number, one: string, few: string, many: string) {
  return `${new Intl.NumberFormat('ru-RU').format(n)} ${pluralRu(n, one, few, many)}`;
}

export function memberSince(iso: string) {
  return `На Лотке с ${new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(iso))}`;
}

export function lastSeen(iso: string | null) {
  if (!iso) return '';
  const min = (Date.now() - new Date(iso).getTime()) / 60000;
  if (min < 5) return 'онлайн';
  return `был(а) ${relativeDate(iso)}`;
}

export { LABELS };
