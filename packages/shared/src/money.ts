/**
 * Деньги хранятся в минимальных единицах (копейках) как целые числа.
 * В БД — bigint, в API — number (безопасно до 2^53 копеек).
 */
export type Minor = number;

export function rublesToMinor(rub: number): Minor {
  if (!Number.isFinite(rub)) throw new Error('Invalid amount');
  return Math.round(rub * 100);
}

export function minorToRubles(minor: Minor): number {
  return minor / 100;
}

const formatters = new Map<string, Intl.NumberFormat>();

function getFormatter(locale: string, currency: string, digits: 0 | 2): Intl.NumberFormat {
  const key = `${locale}:${currency}:${digits}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(key, f);
  }
  return f;
}

export function formatMoney(minor: Minor | null | undefined, currency = 'RUB', locale = 'ru-RU'): string {
  if (minor === null || minor === undefined) return '';
  return getFormatter(locale, currency, minor % 100 === 0 ? 0 : 2).format(minor / 100);
}

/** Процент комиссии в базисных пунктах (1 bp = 0.01%). Округление вниз в пользу пользователя. */
export function applyBasisPoints(amount: Minor, bp: number): Minor {
  return Math.floor((amount * bp) / 10000);
}
