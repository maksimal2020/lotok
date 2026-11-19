'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable } from '@/components/shell';
import { Badge, Button, ErrorState, Input, PageTitle, Pagination, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/auth';
import { dt } from '@/lib/fmt';

interface Org { id: string; name: string; inn: string; ogrn: string | null; status: string; verifiedAt: string | null; createdAt: string }

export default function OrganizationsPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const r = useQuery({ queryKey: ['orgs', q, page], queryFn: () => api.get<{ items: Org[]; total: number }>('/admin/organizations', { q: q || undefined, page, limit: 30 }) });
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); void r.refetch(); } catch (e) { toast(errorMessage(e), 'error'); }
  };
  return (
    <div>
      <PageTitle>Компании</PageTitle>
      <Input className="mb-4 max-w-xs" placeholder="Название или ИНН" value={q} onChange={(e) => setQ(e.target.value)} />
      {r.isError ? <ErrorState message={errorMessage(r.error)} /> : (
        <DataTable rows={r.data?.items} columns={[
          { key: 'n', label: 'Название', render: (o) => <span className="font-semibold">{o.name}</span> },
          { key: 'i', label: 'ИНН / ОГРН', render: (o) => `${o.inn} / ${o.ogrn ?? '—'}` },
          { key: 'v', label: 'Проверка', render: (o) => (o.verifiedAt ? <Badge tone="success">проверена {dt(o.verifiedAt)}</Badge> : <Badge>нет</Badge>) },
          { key: 's', label: 'Статус', render: (o) => <Badge tone={o.status === 'active' ? 'success' : 'danger'}>{o.status}</Badge> },
          { key: 'a', label: '', render: (o) => can('organizations.manage') && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => act(() => api.post(`/admin/organizations/${o.id}/verify`, { verified: !o.verifiedAt }))}>{o.verifiedAt ? 'Снять проверку' : 'Подтвердить'}</Button>
              <Button size="sm" variant="ghost" onClick={() => act(() => api.post(`/admin/organizations/${o.id}/status`, { status: o.status === 'active' ? 'blocked' : 'active' }))}>{o.status === 'active' ? 'Заблокировать' : 'Разблокировать'}</Button>
            </div>
          ) },
        ]} />
      )}
      {r.data && <Pagination page={page} total={r.data.total} limit={30} onChange={setPage} />}
    </div>
  );
}
