'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, ErrorState, PageTitle, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { rub } from '@/lib/fmt';

interface Dashboard {
  users: { active: number; new24h: number };
  listings: { active: number; moderationQueue: number };
  complaints: { open: number };
  orders: { last24h: number };
  payments: { succeeded24h: number; amount24h: number };
  revenue30d: number;
}

export default function DashboardPage() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/admin/dashboard'), refetchInterval: 60_000 });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const tiles = [
    { label: 'Очередь модерации', value: d.listings.moderationQueue, href: '/moderation', alert: d.listings.moderationQueue > 0 },
    { label: 'Открытые жалобы', value: d.complaints.open, href: '/complaints', alert: d.complaints.open > 0 },
    { label: 'Активные объявления', value: d.listings.active, href: '/listings' },
    { label: 'Активные пользователи', value: d.users.active, href: '/users' },
    { label: 'Новых пользователей за 24 ч', value: d.users.new24h },
    { label: 'Заказов за 24 ч', value: d.orders.last24h, href: '/orders' },
    { label: 'Успешных платежей за 24 ч', value: `${d.payments.succeeded24h} · ${rub(d.payments.amount24h)}`, href: '/payments' },
    { label: 'Выручка за 30 дней', value: rub(d.revenue30d), href: '/analytics' },
  ];
  return (
    <div>
      <PageTitle>Обзор</PageTitle>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => {
          const body = (
            <Card className={t.alert ? 'ring-2 ring-accent-300' : ''}>
              <div className="text-sm text-ink-500">{t.label}</div>
              <div className="mt-1 text-2xl font-extrabold">{t.value}</div>
            </Card>
          );
          return t.href ? <Link key={t.label} href={t.href}>{body}</Link> : <div key={t.label}>{body}</div>;
        })}
      </div>
      <p className="mt-6 text-sm text-ink-500">Выручка считается по счёту platform_revenue (услуги и комиссии). Средства продавцов и бонусы учитываются отдельно. Платёжный провайдер в тестовом режиме.</p>
    </div>
  );
}
