import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { CategoryDto, SearchResult } from '@lotok/shared';
import { SearchView } from '@/components/search-view';
import { serverGet } from '@/lib/api';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
type CategoryPage = CategoryDto & { path: { id: number; name: string; slug: string }[] };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await serverGet<CategoryPage>(`/categories/slug/${encodeURIComponent((await params).slug)}`, 300).catch(() => null);
  if (!c) return { title: 'Категория не найдена' };
  return { title: `${c.name} — объявления`, description: `Объявления в категории «${c.name}»: свежие предложения от частных лиц и компаний.`, alternates: { canonical: `/c/${c.slug}` } };
}

export default async function CategoryRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const category = await serverGet<CategoryPage>(`/categories/slug/${encodeURIComponent(slug)}`, 300);
  if (!category) notFound();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') qs.set(k, v);
  qs.set('categoryId', String(category.id));
  const initial = await serverGet<SearchResult>(`/search?${qs.toString()}`, 0).catch(() => null);
  return (
    <>
      <nav aria-label="Хлебные крошки" className="container-page pt-5 text-sm text-ink-500">
        <ol className="flex flex-wrap gap-1.5">
          <li>
            <Link href="/" className="hover:text-brand-600">
              Главная
            </Link>
          </li>
          {category.path.map((p, i) => (
            <li key={p.id} className="flex gap-1.5">
              <span aria-hidden>/</span>
              {i === category.path.length - 1 ? (
                <span aria-current="page" className="text-ink-700">
                  {p.name}
                </span>
              ) : (
                <Link href={`/c/${p.slug}`} className="hover:text-brand-600">
                  {p.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <Suspense>
        <SearchView initial={initial} category={category} title={category.name} />
      </Suspense>
    </>
  );
}
