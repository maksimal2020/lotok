'use client';

import { useQuery } from '@tanstack/react-query';
import { use, useState } from 'react';
import type { ListingStats } from '@lotok/shared';
import { Alert, Card, ErrorState, LinkButton, PageTitle, Spinner, Tabs } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';

type Metric = 'views' | 'contacts' | 'favorites';
const LABEL: Record<Metric, string> = { views: 'Просмотры', contacts: 'Контакты', favorites: 'В избранном' };

/** Столбчатая диаграмма на SVG: доступна (role=img + таблица значений) и без внешних зависимостей. */
function Bars({ data, metric }: { data: ListingStats['daily']; metric: Metric }) {
  const max = Math.max(1, ...data.map((d) => d[metric]));
  const w = 100 / Math.max(1, data.length);
  return (
    <figure>
      <svg viewBox="0 0 100 40" className="h-56 w-full" role="img" aria-label={`${LABEL[metric]} по дням`} preserveAspectRatio="none">
        {data.map((d, i) => {
          const h = (d[metric] / max) * 36;
          return (
            <rect key={d.date} x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h} rx={0.6} fill="#0E8C76">
              <title>{`${new Date(d.date).toLocaleDateString('ru-RU')}: ${d[metric]}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-ink-400">
        <span>{data[0] && new Date(data[0].date).toLocaleDateString('ru-RU')}</span>
        <span>{data.at(-1) && new Date(data.at(-1)!.date).toLocaleDateString('ru-RU')}</span>
      </figcaption>
    </figure>
  );
}

export default function StatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useRequireAuth();
  const [metric, setMetric] = useState<Metric>('views');
  const q = useQuery({ queryKey: ['stats', id], queryFn: () => api.get<ListingStats>(`/listings/${id}/stats`, { extended: 1 }), enabled: !!user });
  if (!user || q.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (q.isError) return <div className="container-page py-10"><ErrorState message={errorMessage(q.error)} /></div>;
  const s = q.data!;
  return (
    <div className="container-page max-w-4xl py-6">
      <PageTitle>Статистика объявления</PageTitle>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {(Object.keys(LABEL) as Metric[]).map((m) => (
          <Card key={m}>
            <div className="text-sm text-ink-500">{LABEL[m]} всего</div>
            <div className="text-3xl font-extrabold">{s.totals[m]}</div>
          </Card>
        ))}
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Tabs value={metric} onChange={setMetric} items={(Object.keys(LABEL) as Metric[]).map((m) => ({ value: m, label: LABEL[m] }))} />
          <span className="text-sm text-ink-500">за {s.extended ? 90 : 14} дней</span>
        </div>
        {s.daily.length ? <Bars data={s.daily} metric={metric} /> : <p className="py-10 text-center text-ink-500">Данных пока нет</p>}
      </Card>
      {!s.extended && (
        <div className="mt-4">
          <Alert tone="info">
            Расширенная статистика за 90 дней доступна с услугой «Расширенная статистика» или PRO-аккаунтом.{' '}
            <LinkButton href="/payments/services" size="sm" variant="outline" className="ml-2">Подключить</LinkButton>
          </Alert>
        </div>
      )}
    </div>
  );
}
