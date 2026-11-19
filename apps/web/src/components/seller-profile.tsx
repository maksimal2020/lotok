'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Star } from 'lucide-react';
import { useState } from 'react';
import type { ListingCard, Paginated, PublicUser, ReviewDto } from '@lotok/shared';
import { api, errorMessage } from '@/lib/api';
import { lastSeen, memberSince, relativeDate } from '@/lib/format';
import { ListingGrid } from './listing-card';
import { Avatar, Badge, EmptyState, ErrorState, Pagination, Skeleton, Tabs } from './ui';

export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex text-accent-500" aria-label={`Оценка ${value} из 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`size-4 ${n <= Math.round(value) ? 'fill-accent-500' : 'text-ink-200'}`} aria-hidden />
      ))}
    </span>
  );
}

export function ReviewsList({ userId }: { userId: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['reviews', userId, page], queryFn: () => api.get<Paginated<ReviewDto> & { distribution: Record<string, number> }>(`/users/${userId}/reviews`, { page, limit: 10 }) });
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  if (!q.data?.items.length) return <EmptyState title="Отзывов пока нет" text="Отзывы оставляют после завершённой сделки или общения по объявлению." />;
  return (
    <div className="space-y-3">
      {q.data.items.map((r) => (
        <div key={r.id} className="rounded-2xl bg-white p-4">
          <div className="flex items-center gap-3">
            <Avatar name={r.author.displayName} url={r.author.avatarUrl} size={36} />
            <div>
              <div className="font-semibold">{r.author.displayName}</div>
              <div className="flex items-center gap-2 text-xs text-ink-500">
                <Stars value={r.rating} /> {relativeDate(r.createdAt)} · {r.role === 'buyer' ? 'покупатель' : 'продавец'}
              </div>
            </div>
          </div>
          {r.listing && <div className="mt-2 text-sm text-ink-500">{r.listing.title}</div>}
          {r.text && <p className="mt-2 whitespace-pre-line break-anywhere">{r.text}</p>}
        </div>
      ))}
      <Pagination page={page} total={q.data.total} limit={10} onChange={setPage} />
    </div>
  );
}

export function SellerProfile({ userId }: { userId: string }) {
  const [tab, setTab] = useState<'listings' | 'reviews'>('listings');
  const [page, setPage] = useState(1);
  const u = useQuery({ queryKey: ['public-user', userId], queryFn: () => api.get<PublicUser>(`/users/${userId}`) });
  const l = useQuery({ queryKey: ['seller-listings', userId, page], queryFn: () => api.get<Paginated<ListingCard>>(`/listings/by-seller/${userId}`, { page, limit: 24 }) });
  if (u.isError) return <div className="container-page py-10"><ErrorState message={errorMessage(u.error)} /></div>;
  return (
    <div className="container-page py-6">
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl bg-white p-5">
        {u.data ? <Avatar name={u.data.displayName} url={u.data.avatarUrl} size={72} /> : <Skeleton className="size-18 rounded-full" />}
        <div className="min-w-0 flex-1">
          <h1 className="break-anywhere text-2xl font-extrabold">{u.data?.displayName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
            {u.data?.ratingAvg ? (
              <>
                <Stars value={u.data.ratingAvg} /> {u.data.ratingAvg.toFixed(1)} · {u.data.ratingCount} отзывов
              </>
            ) : (
              'Нет отзывов'
            )}
            {u.data?.isPro && <Badge tone="brand">PRO</Badge>}
            {u.data?.organization?.verified && <Badge tone="success"><ShieldCheck className="size-3" /> {u.data.organization.name}</Badge>}
          </div>
          {u.data && <div className="mt-1 text-sm text-ink-500">{memberSince(u.data.createdAt)} {u.data.lastSeenAt && `· ${lastSeen(u.data.lastSeenAt)}`}</div>}
        </div>
      </div>
      <div className="mb-4">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'listings', label: 'Объявления', count: u.data?.activeListings }, { value: 'reviews', label: 'Отзывы', count: u.data?.ratingCount }]} />
      </div>
      {tab === 'reviews' ? (
        <ReviewsList userId={userId} />
      ) : l.data && !l.data.items.length ? (
        <EmptyState title="Активных объявлений нет" />
      ) : (
        <>
          <ListingGrid items={l.data?.items} loading={!l.data} />
          {l.data && <Pagination page={page} total={l.data.total} limit={24} onChange={setPage} />}
        </>
      )}
    </div>
  );
}
