'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LABELS, LISTING_STATUSES, type ListingCard, type Paginated } from '@lotok/shared';
import { DataTable } from '@/components/shell';
import { ListingReview } from '@/components/listing-review';
import { Badge, ErrorState, Input, PageTitle, Pagination, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dt, rub } from '@/lib/fmt';

type Row = ListingCard & { updatedAt: string };

export default function ListingsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const r = useQuery({ queryKey: ['admin-listings', page, status, q], queryFn: () => api.get<Paginated<Row>>('/admin/listings', { page, limit: 30, status: status || undefined, q: q || undefined }) });
  return (
    <div>
      <PageTitle>Объявления</PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Название или ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Select className="w-auto!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Статус">
          <option value="">Все статусы</option>
          {LISTING_STATUSES.map((s) => <option key={s} value={s}>{LABELS.listingStatus[s]}</option>)}
        </Select>
      </div>
      {r.isError ? <ErrorState message={errorMessage(r.error)} /> : (
        <DataTable
          rows={r.data?.items}
          onRowClick={(x) => setOpen(x.id)}
          columns={[
            { key: 't', label: 'Название', render: (x) => <span className="font-semibold">{x.title}</span> },
            { key: 's', label: 'Статус', render: (x) => <Badge>{LABELS.listingStatus[x.status]}</Badge> },
            { key: 'c', label: 'Город', render: (x) => x.cityName },
            { key: 'p', label: 'Цена', render: (x) => (x.price !== null ? rub(x.price) : '—') },
            { key: 'u', label: 'Изменено', render: (x) => dt(x.updatedAt) },
          ]}
        />
      )}
      {r.data && <Pagination page={page} total={r.data.total} limit={30} onChange={setPage} />}
      <ListingReview id={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void r.refetch(); }} />
    </div>
  );
}
