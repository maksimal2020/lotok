'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable } from '@/components/shell';
import { ErrorState, Input, PageTitle, Pagination } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Entry { id: number; actorId: string | null; actorName: string | null; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown; ip: string | null; createdAt: string }

export default function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', entityType, entityId, page], queryFn: () => api.get<{ items: Entry[]; total: number }>('/admin/audit', { entityType: entityType || undefined, entityId: entityId || undefined, page, limit: 50 }) });
  return (
    <div>
      <PageTitle>Журнал действий администраторов</PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-[200px]" placeholder="Тип: user, listing…" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
        <Input className="max-w-xs" placeholder="ID объекта" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
      </div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : (
        <DataTable rows={q.data?.items} columns={[
          { key: 'd', label: 'Время', render: (e) => dt(e.createdAt) },
          { key: 'a', label: 'Сотрудник', render: (e) => <span>{e.actorName}<br /><span className="text-xs text-ink-400">{e.ip}</span></span> },
          { key: 'x', label: 'Действие', render: (e) => <b>{e.action}</b> },
          { key: 'o', label: 'Объект', render: (e) => `${e.entityType} ${e.entityId ?? ''}` },
          { key: 'c', label: 'Изменения', render: (e) => <pre className="max-w-md overflow-x-auto whitespace-pre-wrap text-xs text-ink-600">{JSON.stringify({ before: e.before, after: e.after }, null, 1).slice(0, 600)}</pre> },
        ]} />
      )}
      {q.data && <Pagination page={page} total={q.data.total} limit={50} onChange={setPage} />}
      <p className="mt-4 text-xs text-ink-500">Записи журнала неизменяемы: API не предоставляет операций редактирования и удаления.</p>
    </div>
  );
}
