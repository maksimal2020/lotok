'use client';

import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { useState } from 'react';
import type { ListingCard, Paginated, SavedSearchDto } from '@lotok/shared';
import { ListingGrid } from '@/components/listing-card';
import { Badge, Button, EmptyState, ErrorState, LinkButton, PageTitle, Pagination, Spinner, Tabs, useConfirm, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { relativeDate } from '@/lib/format';

function SavedSearches() {
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['saved-searches'], queryFn: () => api.get<SavedSearchDto[]>('/saved-searches') });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState title="Нет сохранённых поисков" text="Нажмите «Сохранить поиск» в результатах — и мы будем присылать уведомления о новых объявлениях." />;
  return (
    <ul className="space-y-2">
      {q.data.map((s) => {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(s.query)) {
          if (k === 'attrs' && v && typeof v === 'object') for (const [ak, av] of Object.entries(v as Record<string, string>)) params.set(`attr.${ak}`, av);
          else if (v !== undefined && v !== null) params.set(k, String(v));
        }
        return (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4">
            <div className="min-w-0">
              <a
                href={`/search?${params.toString()}`}
                onClick={() => void api.patch(`/saved-searches/${s.id}`, { viewed: true })}
                className="break-anywhere font-bold hover:text-brand-600"
              >
                {s.name}
              </a>
              <div className="text-sm text-ink-500">Сохранён {relativeDate(s.createdAt)}</div>
            </div>
            <div className="flex items-center gap-2">
              {s.newCount > 0 && <Badge tone="brand">+{s.newCount} новых</Badge>}
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await api.patch(`/saved-searches/${s.id}`, { notify: !s.notify });
                  void q.refetch();
                }}
              >
                {s.notify ? 'Не уведомлять' : 'Уведомлять'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!(await confirm({ title: 'Удалить поиск?', danger: true, confirmText: 'Удалить' }))) return;
                  await api.delete(`/saved-searches/${s.id}`).catch((e) => toast(errorMessage(e), 'error'));
                  void q.refetch();
                }}
              >
                Удалить
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function FavoritesPage() {
  const { user } = useRequireAuth();
  const [tab, setTab] = useState<'listings' | 'searches'>('listings');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['favorites', page], queryFn: () => api.get<Paginated<ListingCard>>('/favorites', { page, limit: 24 }), enabled: !!user });
  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  return (
    <div className="container-page py-6">
      <PageTitle>Избранное</PageTitle>
      <div className="mb-5">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'listings', label: 'Объявления', count: q.data?.total }, { value: 'searches', label: 'Поиски' }]} />
      </div>
      {tab === 'searches' ? (
        <SavedSearches />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.data && !q.data.items.length ? (
        <EmptyState icon={<Heart className="size-8" />} title="В избранном пусто" text="Нажмите на сердечко на карточке объявления, чтобы вернуться к нему позже." action={<LinkButton href="/">Смотреть объявления</LinkButton>} />
      ) : (
        <>
          <ListingGrid items={q.data?.items} loading={!q.data} />
          {q.data && <Pagination page={page} total={q.data.total} limit={q.data.limit} onChange={setPage} />}
        </>
      )}
    </div>
  );
}
