'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { LABELS, type OrderDto, type Paginated } from '@lotok/shared';
import { Badge, EmptyState, ErrorState, PageTitle, Pagination, Skeleton, Spinner, Tabs } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { relativeDate, rub } from '@/lib/format';

const orderTone = (s: OrderDto['status']) =>
  s === 'completed' ? 'success' : s === 'canceled' || s === 'refunded' ? 'neutral' : s === 'pending_payment' || s === 'refund_requested' ? 'warning' : 'brand';

export default function OrdersPage() {
  const { user } = useRequireAuth();
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['orders', role, page], queryFn: () => api.get<Paginated<OrderDto>>('/orders', { role, page, limit: 20 }), enabled: !!user });
  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  return (
    <div className="container-page max-w-4xl py-6">
      <PageTitle>Заказы</PageTitle>
      <div className="mb-5">
        <Tabs value={role} onChange={(v) => { setRole(v); setPage(1); }} items={[{ value: 'buyer', label: 'Мои покупки' }, { value: 'seller', label: 'Мои продажи' }]} />
      </div>
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.isLoading && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>}
      {q.data && !q.data.items.length && <EmptyState title={role === 'buyer' ? 'Покупок пока нет' : 'Продаж пока нет'} text="Здесь появятся заказы, оформленные с оплатой онлайн или самовывозом." />}
      <div className="space-y-3">
        {q.data?.items.map((o) => (
          <Link key={o.id} href={`/orders/${o.id}`} className="flex gap-4 rounded-2xl bg-white p-4 hover:shadow-[var(--shadow-card)]">
            <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-ink-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {o.listing.photo?.thumb && <img src={o.listing.photo.thumb} alt="" className="size-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={orderTone(o.status)}>{LABELS.orderStatus[o.status]}</Badge>
                <span className="text-sm text-ink-500">№ {o.number} · {relativeDate(o.createdAt)}</span>
              </div>
              <div className="mt-1 truncate font-bold">{o.listing.title}</div>
              <div className="text-sm text-ink-500">
                {rub(o.total)} · {o.deliveryMethod === 'delivery' ? 'доставка' : 'самовывоз'} · {role === 'buyer' ? `продавец ${o.seller.displayName}` : `покупатель ${o.buyer.displayName}`}
              </div>
            </div>
          </Link>
        ))}
      </div>
      {q.data && <Pagination page={page} total={q.data.total} limit={q.data.limit} onChange={setPage} />}
    </div>
  );
}
