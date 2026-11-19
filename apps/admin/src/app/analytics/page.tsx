'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, ErrorState, PageTitle, Spinner, Tabs } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { rub } from '@/lib/fmt';

interface Analytics {
  daily: { day: string; users: number; listings: number; orders: number; revenue: number }[];
  topCategories: { name: string; count: number }[];
}
type Metric = 'users' | 'listings' | 'orders' | 'revenue';
const LABEL: Record<Metric, string> = { users: 'Регистрации', listings: 'Публикации', orders: 'Заказы', revenue: 'Выручка' };

function Line({ data, metric }: { data: Analytics['daily']; metric: Metric }) {
  const max = Math.max(1, ...data.map((d) => d[metric]));
  const pts = data.map((d, i) => `${(i / Math.max(1, data.length - 1)) * 100},${40 - (d[metric] / max) * 36}`).join(' ');
  return (
    <svg viewBox="0 0 100 42" className="h-64 w-full" preserveAspectRatio="none" role="img" aria-label={`${LABEL[metric]} по дням`}>
      <polyline points={`0,40 ${pts} 100,40`} fill="#E8F7F4" stroke="none" />
      <polyline points={pts} fill="none" stroke="#0E8C76" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState('30');
  const [metric, setMetric] = useState<Metric>('users');
  const q = useQuery({ queryKey: ['analytics', days], queryFn: () => api.get<Analytics>('/admin/analytics', { days }) });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  const totals = q.data?.daily.reduce((s, d) => ({ users: s.users + d.users, listings: s.listings + d.listings, orders: s.orders + d.orders, revenue: s.revenue + d.revenue }), { users: 0, listings: 0, orders: 0, revenue: 0 });
  return (
    <div>
      <PageTitle actions={<Tabs value={days} onChange={setDays} items={[{ value: '7', label: '7 дней' }, { value: '30', label: '30 дней' }, { value: '90', label: '90 дней' }]} />}>Аналитика</PageTitle>
      {!q.data ? <Spinner /> : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            {(Object.keys(LABEL) as Metric[]).map((m) => (
              <button key={m} onClick={() => setMetric(m)} className={`rounded-2xl bg-white p-4 text-left ${metric === m ? 'ring-2 ring-brand-500' : ''}`}>
                <div className="text-sm text-ink-500">{LABEL[m]}</div>
                <div className="text-2xl font-extrabold">{m === 'revenue' ? rub(totals![m]) : totals![m]}</div>
              </button>
            ))}
          </div>
          <Card className="mb-5">
            <div className="mb-2 font-bold">{LABEL[metric]} по дням</div>
            <Line data={q.data.daily} metric={metric} />
            <div className="flex justify-between text-xs text-ink-400"><span>{q.data.daily[0]?.day}</span><span>{q.data.daily.at(-1)?.day}</span></div>
          </Card>
          <Card>
            <div className="mb-3 font-bold">Активные объявления по категориям</div>
            <ul className="space-y-2">
              {q.data.topCategories.map((c) => {
                const max = q.data!.topCategories[0]?.count || 1;
                return (
                  <li key={c.name} className="text-sm">
                    <div className="flex justify-between"><span>{c.name}</span><span className="font-semibold">{c.count}</span></div>
                    <div className="mt-1 h-2 rounded-full bg-ink-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(c.count / max) * 100}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
