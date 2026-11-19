/** Знак «Лоток»: торговый лоток с полосатым навесом. Оригинальная графика. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect width="40" height="40" rx="11" fill="#0E8C76" />
      <path d="M8 14h24l-2.2-5.2A2 2 0 0 0 28 7.6H12a2 2 0 0 0-1.8 1.2L8 14Z" fill="#fff" />
      <path d="M8 14c0 2.2 1.8 3.6 4 3.6S16 16.2 16 14c0 2.2 1.8 3.6 4 3.6S24 16.2 24 14c0 2.2 1.8 3.6 4 3.6S32 16.2 32 14" fill="#F59E0B" />
      <rect x="10.5" y="20" width="19" height="12" rx="2.5" fill="#fff" />
      <rect x="15" y="24" width="10" height="2.6" rx="1.3" fill="#0E8C76" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-xl font-extrabold tracking-tight text-ink-900">Лоток</span>
    </span>
  );
}
