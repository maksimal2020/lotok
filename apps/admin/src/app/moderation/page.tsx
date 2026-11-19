'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ListingCard, Paginated } from '@lotok/shared';
import { DataTable } from '@/components/shell';
import { flagLabel, ListingReview } from '@/components/listing-review';
import { Badge, ErrorState, PageTitle, Pagination } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dt, rub } from '@/lib/fmt';

type Row = ListingCard & { flags: string[]; description: string; updatedAt: string };

export default function ModerationPage() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['queue', page], queryFn: () => api.get<Paginated<Row>>('/admin/moderation/queue', { page, limit: 30 }) });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  return (
    <div>
      <PageTitle>Модерация {q.data && <span className="text-ink-400">· {q.data.total}</span>}</PageTitle>
      <p className="mb-4 text-sm text-ink-500">Объявления, не прошедшие автоматическую проверку. Сначала самые давние.</p>
      <DataTable
        rows={q.data?.items}
        empty="Очередь пуста"
        onRowClick={(r) => setOpen(r.id)}
        columns={[
          // eslint-disable-next-line @next/next/no-img-element
          { key: 'p', label: '', render: (r) => (r.photo?.thumb ? <img src={r.photo.thumb} alt="" className="size-14 rounded-lg object-cover" /> : null), className: 'w-20' },
          { key: 't', label: 'Объявление', render: (r) => <div className="max-w-md"><div className="font-semibold">{r.title}</div><div className="line-clamp-2 text-ink-500">{r.description}</div></div> },
          { key: 'f', label: 'Признаки', render: (r) => <div className="flex flex-wrap gap-1">{r.flags.map((f) => <Badge key={f} tone="warning">{flagLabel(f)}</Badge>)}</div> },
          { key: 'pr', label: 'Цена', render: (r) => (r.price !== null ? rub(r.price) : '—') },
          { key: 'd', label: 'Изменено', render: (r) => dt(r.updatedAt) },
        ]}
      />
      {q.data && <Pagination page={page} total={q.data.total} limit={30} onChange={setPage} />}
      <ListingReview id={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void q.refetch(); }} />
    </div>
  );
}
