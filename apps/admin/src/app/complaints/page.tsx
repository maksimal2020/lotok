'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { COMPLAINT_STATUSES, LABELS, type ComplaintDto, type Paginated } from '@lotok/shared';
import { DataTable } from '@/components/shell';
import { Badge, Button, Checkbox, ErrorState, Field, Modal, PageTitle, Pagination, Select, Spinner, Tabs, Textarea, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/auth';
import { dt } from '@/lib/fmt';

const TARGET: Record<string, string> = { listing: 'Объявление', user: 'Пользователь', message: 'Сообщение', review: 'Отзыв' };

function Resolve({ id, onDone }: { id: string | null; onDone: () => void }) {
  const { can } = useAdmin();
  const toast = useToast();
  const [status, setStatus] = useState<'resolved' | 'rejected' | 'in_review'>('resolved');
  const [resolution, setResolution] = useState('');
  const [block, setBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['complaint', id], queryFn: () => api.get<{ complaint: ComplaintDto; target: Record<string, unknown> | null }>(`/admin/complaints/${id}`), enabled: !!id });
  const t = q.data?.target as Record<string, unknown> | null | undefined;
  return (
    <Modal open={!!id} onClose={onDone} title="Жалоба" size="lg"
      footer={can('complaints.handle') && q.data && ['new', 'in_review'].includes(q.data.complaint.status) && (
        <Button loading={busy} onClick={async () => {
          setBusy(true);
          try {
            await api.post(`/admin/complaints/${id}/resolve`, { status, resolution: resolution || undefined, blockTarget: status === 'resolved' && block });
            toast('Жалоба обработана');
            onDone();
          } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
        }}>Сохранить решение</Button>
      )}
    >
      {!q.data ? <Spinner /> : (
        <div className="space-y-4">
          <div className="text-sm">
            <b>{TARGET[q.data.complaint.targetType]}</b> · {LABELS.complaintReason[q.data.complaint.reason]} · {dt(q.data.complaint.createdAt)}
            {q.data.complaint.comment && <p className="mt-1 rounded-lg bg-ink-50 p-2">{q.data.complaint.comment}</p>}
          </div>
          <div className="rounded-xl border border-ink-100 p-3 text-sm">
            <div className="mb-1 font-semibold">Объект жалобы</div>
            {!t ? 'Объект удалён' : (
              <div className="space-y-1 break-anywhere">
                {'title' in t && <div className="font-semibold">{String(t.title)}</div>}
                {'description' in t && <p className="line-clamp-4 text-ink-600">{String(t.description)}</p>}
                {'displayName' in t && <div>{String(t.displayName)} · {String(t.email ?? '')} · статус {String(t.status)}</div>}
                {'body' in t && <p>{String(t.body)}</p>}
                {'text' in t && <p>Отзыв: {String(t.rating)}★ {String(t.text)}</p>}
              </div>
            )}
          </div>
          {can('complaints.handle') && ['new', 'in_review'].includes(q.data.complaint.status) && (
            <>
              <Field label="Решение" htmlFor="cs">
                <Select id="cs" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                  <option value="resolved">Нарушение подтверждено</option>
                  <option value="rejected">Нарушений нет</option>
                  <option value="in_review">Взять в работу</option>
                </Select>
              </Field>
              {status === 'resolved' && <Checkbox label="Применить меры к объекту (блокировка/скрытие)" checked={block} onChange={setBlock} />}
              <Field label="Комментарий решения" htmlFor="cr"><Textarea id="cr" value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function ComplaintsPage() {
  const [status, setStatus] = useState<string>('new');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['complaints', status, page], queryFn: () => api.get<Paginated<ComplaintDto>>('/admin/complaints', { status, page, limit: 30 }) });
  return (
    <div>
      <PageTitle>Жалобы</PageTitle>
      <div className="mb-4"><Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={COMPLAINT_STATUSES.map((s) => ({ value: s, label: LABELS.complaintStatus[s] }))} /></div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : (
        <DataTable
          rows={q.data?.items}
          onRowClick={(c) => setOpen(c.id)}
          columns={[
            { key: 'd', label: 'Дата', render: (c) => dt(c.createdAt) },
            { key: 't', label: 'Объект', render: (c) => <Badge>{TARGET[c.targetType]}</Badge> },
            { key: 'r', label: 'Причина', render: (c) => LABELS.complaintReason[c.reason] },
            { key: 'c', label: 'Комментарий', render: (c) => <span className="line-clamp-2 max-w-sm">{c.comment}</span> },
            { key: 'u', label: 'Автор', render: (c) => c.reporter?.displayName },
          ]}
        />
      )}
      {q.data && <Pagination page={page} total={q.data.total} limit={30} onChange={setPage} />}
      <Resolve id={open} onDone={() => { setOpen(null); void q.refetch(); }} />
    </div>
  );
}
