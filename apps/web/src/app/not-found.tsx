import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container-page flex flex-col items-center gap-4 py-20 text-center">
      <div className="text-6xl font-extrabold text-brand-500">404</div>
      <h1 className="text-2xl font-extrabold">Страница не найдена</h1>
      <p className="max-w-md text-ink-500">Возможно, объявление снято с публикации или ссылка устарела.</p>
      <Link href="/" className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white hover:bg-brand-600">
        На главную
      </Link>
    </div>
  );
}
