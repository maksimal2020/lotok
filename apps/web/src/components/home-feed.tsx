'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdPlacementDto, ListingCard } from '@lotok/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ListingGrid } from './listing-card';
import { EmptyState, ErrorState } from './ui';

export function AdBanner({ slot }: { slot: string }) {
  const { data } = useQuery({ queryKey: ['ads', slot], queryFn: () => api.get<AdPlacementDto[]>('/billing/ads', { slot }), staleTime: 300_000 });
  const ad = data?.[0];
  if (!ad) return null;
  return (
    <a
      href={ad.targetUrl}
      target="_blank"
      rel="noopener sponsored"
      onClick={() => void api.post(`/billing/ads/${ad.id}/click`).catch(() => undefined)}
      className="relative mb-8 block overflow-hidden rounded-2xl bg-white"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ad.imageUrl} alt={ad.title} className="h-32 w-full object-cover md:h-40" loading="lazy" />
      {/* Маркировка рекламы по 347-ФЗ: пометка «Реклама», рекламодатель и erid */}
      <span className="absolute left-3 top-3 rounded-md bg-white/90 px-2 py-0.5 text-[11px] text-ink-700">
        Реклама · {ad.advertiser} · erid: {ad.erid}
      </span>
    </a>
  );
}

export function HomeFeed() {
  const { user, ready } = useAuth();
  const rec = useQuery({
    queryKey: ['recommendations', user?.id ?? 'anon'],
    queryFn: () => api.get<{ items: ListingCard[]; strategy: string }>('/recommendations', user?.cityId ? { cityId: user.cityId } : undefined),
    enabled: ready,
  });
  return (
    <>
      <AdBanner slot="home_top" />
      <section aria-labelledby="rec">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="rec" className="text-xl font-extrabold md:text-2xl">
            {rec.data?.strategy === 'interests' ? 'Рекомендации для вас' : 'Популярное сейчас'}
          </h2>
          {rec.data?.strategy === 'interests' && <span className="text-xs text-ink-400">на основе ваших просмотров и избранного</span>}
        </div>
        {rec.isError ? (
          <ErrorState message={errorMessage(rec.error)} onRetry={() => rec.refetch()} />
        ) : rec.data && !rec.data.items.length ? (
          <EmptyState title="Пока нет объявлений" text="Станьте первым — разместите объявление." />
        ) : (
          <ListingGrid items={rec.data?.items} loading={!rec.data} cols={5} />
        )}
      </section>
    </>
  );
}
