'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="container-page flex flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-2xl font-extrabold">Что-то пошло не так</h1>
      <p className="max-w-md text-ink-500">Мы уже знаем о проблеме. Попробуйте обновить страницу.{error.digest ? ` Код: ${error.digest}` : ''}</p>
      <button onClick={reset} className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white">
        Повторить
      </button>
    </div>
  );
}
