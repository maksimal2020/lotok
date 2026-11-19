import Link from 'next/link';
import type { CategoryDto } from '@lotok/shared';
import { CategoryIcon, VERTICAL_COLORS } from '@/components/category-icon';
import { HomeFeed } from '@/components/home-feed';
import { serverGet } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const tree = (await serverGet<CategoryDto[]>('/categories', 300).catch(() => null)) ?? [];
  const tiles = tree.flatMap((root) => (root.slug === 'goods' ? (root.children ?? []).slice(0, 7) : [root]));
  return (
    <div className="container-page py-6 md:py-8">
      <section aria-labelledby="cats" className="mb-8">
        <h2 id="cats" className="sr-only">
          Категории
        </h2>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-2.5 xl:grid-cols-12">
          {tiles.map((c) => (
            <Link key={c.id} href={`/c/${c.slug}`} className="group flex flex-col items-center gap-2 rounded-2xl bg-white p-2 text-center transition md:p-3 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]">
              <span className={`flex size-11 items-center justify-center rounded-2xl md:size-12 ${VERTICAL_COLORS[c.vertical]}`}>
                <CategoryIcon name={c.icon} />
              </span>
              <span className="line-clamp-2 break-anywhere text-[12px] font-semibold leading-tight md:text-[13px]">{c.name}</span>
            </Link>
          ))}
          <Link href="/catalog" className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white p-3 text-center text-[13px] font-semibold text-brand-600 hover:shadow-[var(--shadow-card)]">
            Все категории →
          </Link>
        </div>
      </section>
      <HomeFeed />
      <section className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          ['Публикуйте бесплатно', 'Разместите объявление за пару минут: фото, цена и характеристики. Большинство категорий — без оплаты.'],
          ['Общайтесь в чате', 'Пишите продавцу во встроенном мессенджере — не нужно показывать номер телефона.'],
          ['Покупайте с доставкой', 'Оформите заказ с оплатой онлайн и доставкой. Сейчас платежи работают в тестовом режиме.'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl bg-white p-5">
            <h3 className="font-bold">{t}</h3>
            <p className="mt-1.5 text-sm text-ink-500">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
