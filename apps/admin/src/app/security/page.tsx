'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable } from '@/components/shell';
import { Badge, ErrorState, PageTitle, Pagination, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Ev { id: number; userId: string | null; type: string; ip: string | null; userAgent: string | null; meta: Record<string, unknown>; createdAt: string }
const TYPES = ['login_failed', 'login_locked', 'login_success', 'refresh_token_reuse', 'password_reset', 'sms_rate_limited', 'upload_rejected_type', 'upload_malware', 'payment_webhook_invalid_signature', 'payment_amount_mismatch', 'logout_all'];
const danger = new Set(['login_locked', 'refresh_token_reuse', 'upload_malware', 'payment_webhook_invalid_signature', 'payment_amount_mismatch']);

export default function SecurityPage() {
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['sec', type, page], queryFn: () => api.get<{ items: Ev[]; total: number }>('/admin/security-events', { type: type || undefined, page, limit: 50 }) });
  return (
    <div>
      <PageTitle>События безопасности</PageTitle>
      <Select className="mb-4 w-auto!" aria-label="Тип" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="">Все события</option>
        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </Select>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : (
        <DataTable rows={q.data?.items} columns={[
          { key: 'd', label: 'Время', render: (e) => dt(e.createdAt) },
          { key: 't', label: 'Событие', render: (e) => <Badge tone={danger.has(e.type) ? 'danger' : 'neutral'}>{e.type}</Badge> },
          { key: 'u', label: 'Пользователь', render: (e) => <span className="text-xs">{e.userId}</span> },
          { key: 'i', label: 'IP', render: (e) => e.ip },
          { key: 'm', label: 'Детали', render: (e) => <span className="text-xs text-ink-600">{JSON.stringify(e.meta).slice(0, 160)}</span> },
        ]} />
      )}
      {q.data && <Pagination page={page} total={q.data.total} limit={50} onChange={setPage} />}
    </div>
  );
}
