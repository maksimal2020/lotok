import type { Metadata } from 'next';
import { Suspense } from 'react';
import type { SearchResult } from '@lotok/shared';
import { SearchView } from '@/components/search-view';
import { serverGet } from '@/lib/api';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = (await searchParams).q;
  return { title: q ? `«${q}» — результаты поиска` : 'Поиск объявлений', robots: { index: false } };
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') qs.set(k, v);
  const initial = await serverGet<SearchResult>(`/search?${qs.toString()}`, 0).catch(() => null);
  const q = typeof sp.q === 'string' ? sp.q : '';
  return (
    <Suspense>
      <SearchView initial={initial} title={q ? `Объявления по запросу «${q}»` : 'Все объявления'} />
    </Suspense>
  );
}
