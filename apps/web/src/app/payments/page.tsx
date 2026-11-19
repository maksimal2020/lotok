'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { LABELS, type Paginated, type PaymentDto, type PurchaseDto } from '@lotok/shared';
import { Badge, Card, EmptyState, ErrorState, LinkButton, PageTitle, Pagination, Spinner, Tabs } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { dateTime, rub } from '@/lib/format';

const PURCHASE_LABEL: Record<PurchaseDto['status'], string> = {
  pending_payment: 'Ожидает оплаты',
  active: 'Активна',
  consumed: 'Использована',
  expired: 'Истекла',
  canceled: 'Отменена',
  refunded: 'Возвращена',
};

export default function PaymentsPage() {
  const { user } = useRequireAuth();
  const [tab, setTab] = useState<'payments' | 'purchases' | 'bonus'>('payments');
  const [page, setPage] = useState(1);
  const payments = useQuery({ queryKey: ['payments', page], queryFn: () => api.get<Paginated<PaymentDto>>('/payments', { page, limit: 20 }), enabled: !!user && tab === 'payments' });
  const purchases = useQuery({ queryKey: ['purchases', page], queryFn: () => api.get<Paginated<PurchaseDto>>('/billing/purchases', { page, limit: 20 }), enabled: !!user && tab === 'purchases' });
  const ledger = useQuery({
    queryKey: ['ledger'],
    queryFn: () => api.get<{ id: number; amount: number; account: string; kind: string; description: string; createdAt: string }[]>('/payments/ledger'),
    enabled: !!user && tab === 'bonus',
  });
  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  const active = tab === 'payments' ? payments : tab === 'purchases' ? purchases : ledger;
  return (
    <div className="container-page max-w-4xl py-6">
      <PageTitle actions={<LinkButton href="/payments/services" variant="accent">Платные услуги</LinkButton>}>Платежи и услуги</PageTitle>
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="text-sm text-ink-500">Бонусный баланс</div>
          <div className="text-2xl font-extrabold">{rub(user.bonusBalance)}</div>
          <div className="text-xs text-ink-400">Бонусы не являются деньгами и используются только для оплаты услуг</div>
        </Card>
        <Card>
          <div className="text-sm text-ink-500">Профессиональный аккаунт</div>
          <div className="text-2xl font-extrabold">{user.proUntil ? `до ${new Date(user.proUntil).toLocaleDateString('ru-RU')}` : 'не подключён'}</div>
        </Card>
      </div>
      <div className="mb-4">
        <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} items={[{ value: 'payments', label: 'Платежи' }, { value: 'purchases', label: 'Услуги' }, { value: 'bonus', label: 'История операций' }]} />
      </div>
      {active.isLoading && <Spinner />}
      {active.isError && <ErrorState message={errorMessage(active.error)} onRetry={() => active.refetch()} />}
      {tab === 'payments' && payments.data && (
        payments.data.items.length ? (
          <div className="overflow-hidden rounded-2xl bg-white">
            {payments.data.items.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-50 p-4">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.description}</div>
                  <div className="text-sm text-ink-500">
                    {dateTime(p.createdAt)} {p.testMode && <Badge tone="warning">тест</Badge>} {p.orderId && <Link href={`/orders/${p.orderId}`} className="text-brand-600">заказ</Link>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{rub(p.amount)}</div>
                  <div className="text-sm text-ink-500">{LABELS.paymentStatus[p.status]}{p.refundedAmount ? ` · возврат ${rub(p.refundedAmount)}` : ''}</div>
                  {p.confirmationUrl && <a href={p.confirmationUrl} className="text-sm font-semibold text-brand-600">Оплатить</a>}
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Платежей пока нет" />
      )}
      {tab === 'purchases' && purchases.data && (
        purchases.data.items.length ? (
          <div className="overflow-hidden rounded-2xl bg-white">
            {purchases.data.items.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-50 p-4">
                <div>
                  <div className="font-semibold">{p.service.name}</div>
                  <div className="text-sm text-ink-500">
                    {dateTime(p.createdAt)}
                    {p.endsAt && ` · до ${new Date(p.endsAt).toLocaleDateString('ru-RU')}`}
                    {p.quantityRemaining !== null && ` · осталось ${p.quantityRemaining}`}
                    {p.listingId && <> · <Link href={`/listing/${p.listingId}`} className="text-brand-600">объявление</Link></>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{rub(p.price)}</div>
                  <Badge tone={p.status === 'active' ? 'success' : 'neutral'}>{PURCHASE_LABEL[p.status]}</Badge>
                  {p.paidWithBonus > 0 && <div className="text-xs text-ink-500">бонусами {rub(p.paidWithBonus)}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Услуг пока нет" action={<LinkButton href="/payments/services">Посмотреть услуги</LinkButton>} />
      )}
      {tab === 'bonus' && ledger.data && (
        ledger.data.length ? (
          <div className="overflow-hidden rounded-2xl bg-white">
            {ledger.data.map((e) => (
              <div key={e.id} className="flex justify-between gap-3 border-b border-ink-50 p-4">
                <div>
                  <div className="font-semibold">{e.description}</div>
                  <div className="text-sm text-ink-500">{dateTime(e.createdAt)} · {e.account === 'user_bonus' ? 'бонусный счёт' : 'расчёты с продавцом'}</div>
                </div>
                <div className={`font-bold ${e.amount > 0 ? 'text-success' : ''}`}>{e.account === 'seller_payable' ? rub(-e.amount) : `${e.amount > 0 ? '+' : ''}${rub(e.amount)}`}</div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Операций пока нет" />
      )}
      {(tab === 'payments' ? payments.data : purchases.data) && tab !== 'bonus' && (
        <Pagination page={page} total={(tab === 'payments' ? payments.data! : purchases.data!).total} limit={20} onChange={setPage} />
      )}
    </div>
  );
}
