'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, Eye, Heart, MessageCircle, Pencil, Plus, Rocket } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LABELS, type ListingCard, type ListingStatus } from '@lotok/shared';
import { Badge, Button, EmptyState, ErrorState, LinkButton, PageTitle, Pagination, Skeleton, Spinner, Tabs, useConfirm, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { priceLabel, relativeDate } from '@/lib/format';

type MyItem = ListingCard & { viewsCount: number; favoritesCount: number; contactsCount: number; rejectionReason: string | null; expiresAt: string | null };
type MyResult = { items: MyItem[]; total: number; page: number; limit: number; counts: Partial<Record<ListingStatus, number>> };

const TABS: { value: string; label: string; statuses: ListingStatus[] }[] = [
  { value: 'active', label: 'Активные', statuses: ['active'] },
  { value: 'moderation', label: 'На проверке', statuses: ['moderation'] },
  { value: 'draft', label: 'Черновики', statuses: ['draft'] },
  { value: 'rejected', label: 'Отклонённые', statuses: ['rejected'] },
  { value: 'inactive', label: 'Снятые', statuses: ['inactive'] },
  { value: 'sold', label: 'Проданные', statuses: ['sold'] },
  { value: 'expired', label: 'Истёкшие', statuses: ['expired'] },
  { value: 'archived', label: 'Архив', statuses: ['archived'] },
  { value: 'blocked', label: 'Заблокированные', statuses: ['blocked'] },
];

const tone = (s: ListingStatus) => (s === 'active' ? 'success' : s === 'rejected' || s === 'blocked' ? 'danger' : s === 'moderation' ? 'warning' : 'neutral');

function MyListings() {
  const { user } = useRequireAuth();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const status = params.get('status') ?? 'active';
  const page = Number(params.get('page') ?? 1);
  const q = useQuery({ queryKey: ['my-listings', status, page], queryFn: () => api.get<MyResult>('/listings/mine', { status, page, limit: 20 }), enabled: !!user });

  const act = async (id: string, action: string, confirmText?: string) => {
    if (confirmText && !(await confirm({ title: confirmText, danger: action === 'delete', confirmText: 'Да' }))) return;
    try {
      if (action === 'delete') await api.delete(`/listings/${id}`);
      else await api.post(`/listings/${id}/${action}`);
      toast('Готово');
      void q.refetch();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  return (
    <div className="container-page py-6">
      <PageTitle actions={<LinkButton href="/listings/new" variant="accent"><Plus className="size-4" /> Разместить</LinkButton>}>Мои объявления</PageTitle>
      <div className="mb-5">
        <Tabs
          value={status}
          onChange={(v) => router.push(`/my/listings?status=${v}`)}
          items={TABS.filter((t) => t.value === 'active' || t.value === status || q.data?.counts[t.statuses[0]]).map((t) => ({ value: t.value, label: t.label, count: q.data?.counts[t.statuses[0]] ?? 0 }))}
        />
      </div>
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.isLoading && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>}
      {q.data && !q.data.items.length && <EmptyState title="Здесь пока пусто" text="Объявления в этом статусе появятся здесь." action={<LinkButton href="/listings/new">Разместить объявление</LinkButton>} />}
      <div className="space-y-3">
        {q.data?.items.map((l) => (
          <article key={l.id} className="flex flex-col gap-4 rounded-2xl bg-white p-4 sm:flex-row">
            <Link href={`/listing/${l.id}`} className="aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl bg-ink-100 sm:w-44">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {l.photo?.thumb && <img src={l.photo.thumb} alt="" className="size-full object-cover" />}
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={tone(l.status)}>{LABELS.listingStatus[l.status]}</Badge>
                {l.isPremium && <Badge tone="accent">Премиум</Badge>}
                {l.isHighlighted && !l.isPremium && <Badge tone="accent">Выделено</Badge>}
              </div>
              <Link href={`/listing/${l.id}`} className="mt-1 block break-anywhere text-lg font-bold hover:text-brand-600">
                {l.title}
              </Link>
              <div className="font-extrabold">{priceLabel(l)}</div>
              {l.rejectionReason && (l.status === 'rejected' || l.status === 'blocked') && <p className="mt-1 text-sm text-danger">Причина: {l.rejectionReason}</p>}
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink-500">
                <span className="flex items-center gap-1"><Eye className="size-4" /> {l.viewsCount}</span>
                <span className="flex items-center gap-1"><Heart className="size-4" /> {l.favoritesCount}</span>
                <span className="flex items-center gap-1"><MessageCircle className="size-4" /> {l.contactsCount}</span>
                {l.status === 'active' && l.expiresAt && <span>до {new Date(l.expiresAt).toLocaleDateString('ru-RU')}</span>}
                {l.publishedAt && <span>опубл. {relativeDate(l.publishedAt)}</span>}
              </div>
            </div>
            <div className="flex flex-wrap content-start gap-2 sm:w-56 sm:flex-col">
              {l.status !== 'blocked' && <LinkButton href={`/listings/${l.id}/edit`} variant="outline" size="sm"><Pencil className="size-4" /> Редактировать</LinkButton>}
              {l.status === 'active' && (
                <>
                  <LinkButton href={`/promote/${l.id}`} variant="accent" size="sm"><Rocket className="size-4" /> Продвинуть</LinkButton>
                  <LinkButton href={`/my/listings/${l.id}/stats`} variant="ghost" size="sm"><BarChart3 className="size-4" /> Статистика</LinkButton>
                  <Button size="sm" variant="secondary" onClick={() => act(l.id, 'sold', 'Отметить как проданное?')}>Продано</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(l.id, 'unpublish', 'Снять с публикации?')}>Снять с публикации</Button>
                </>
              )}
              {(l.status === 'draft' || l.status === 'rejected') && <Button size="sm" onClick={() => act(l.id, 'submit')}>Отправить на проверку</Button>}
              {['inactive', 'expired', 'sold', 'archived'].includes(l.status) && <Button size="sm" onClick={() => act(l.id, 'republish')}>Опубликовать снова</Button>}
              {['inactive', 'expired', 'sold', 'rejected'].includes(l.status) && <Button size="sm" variant="ghost" onClick={() => act(l.id, 'archive')}>В архив</Button>}
              {['draft', 'rejected', 'inactive', 'sold', 'expired', 'archived'].includes(l.status) && (
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => act(l.id, 'delete', 'Удалить объявление навсегда?')}>Удалить</Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {q.data && <Pagination page={page} total={q.data.total} limit={q.data.limit} onChange={(p) => router.push(`/my/listings?status=${status}&page=${p}`)} />}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <MyListings />
    </Suspense>
  );
}
