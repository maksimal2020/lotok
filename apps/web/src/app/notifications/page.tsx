'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import type { CursorPage, NotificationDto } from '@lotok/shared';
import { Button, EmptyState, ErrorState, PageTitle, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { relativeDate } from '@/lib/format';

function linkFor(n: NotificationDto): string | null {
  const d = n.data as Record<string, string>;
  if (d.orderId) return `/orders/${d.orderId}`;
  if (d.conversationId) return `/messages/${d.conversationId}`;
  if (d.listingId) return `/listing/${d.listingId}`;
  if (d.savedSearchId) return '/favorites';
  if (d.purchaseId) return '/payments';
  return null;
}

export default function NotificationsPage() {
  const { user } = useRequireAuth();
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => api.get<CursorPage<NotificationDto>>('/notifications', { cursor: pageParam as string | undefined, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    enabled: !!user,
  });
  useEffect(() => {
    if (!q.data) return;
    // Отмечаем просмотренные уведомления прочитанными.
    void api.post('/notifications/read', { ids: 'all' }).then(() => qc.invalidateQueries({ queryKey: ['notes-unread'] }));
  }, [q.data, qc]);
  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="container-page max-w-3xl py-6">
      <PageTitle>Уведомления</PageTitle>
      {q.isLoading && <Spinner />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && !items.length && <EmptyState icon={<Bell className="size-8" />} title="Уведомлений нет" text="Здесь появятся новости о ваших объявлениях, заказах и подписках." />}
      <ul className="space-y-2">
        {items.map((n) => {
          const href = linkFor(n);
          const body = (
            <div className={clsx('rounded-2xl bg-white p-4', !n.readAt && 'border-l-4 border-brand-500')}>
              <div className="flex justify-between gap-3">
                <span className="font-bold">{n.title}</span>
                <span className="shrink-0 text-xs text-ink-400">{relativeDate(n.createdAt)}</span>
              </div>
              <p className="mt-1 break-anywhere text-ink-700">{n.body}</p>
            </div>
          );
          return <li key={n.id}>{href ? <Link href={href}>{body}</Link> : body}</li>;
        })}
      </ul>
      {q.hasNextPage && <div className="mt-4 text-center"><Button variant="outline" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Показать ещё</Button></div>}
    </div>
  );
}
