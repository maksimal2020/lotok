'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LABELS, ORDER_STATUSES, type OrderDto, type Paginated } from '@lotok/shared';
import { DataTable } from '@/components/shell';
import { Badge, Button, ErrorState, Field, Modal, PageTitle, Pagination, Select, Textarea, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/auth';
import { dt, rub } from '@/lib/fmt';

const ACT: Record<string, string> = { cancel: 'Отменить (с возвратом)', deliver: 'Отметить доставку', complete: 'Завершить', approve_refund: 'Одобрить возврат', reject_refund: 'Отклонить возврат' };

export default function OrdersPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<OrderDto | null>(null);
  const [reason, setReason] = useState('');
  const r = useQuery({ queryKey: ['admin-orders', status, page], queryFn: () => api.get<Paginated<OrderDto>>('/admin/orders', { status: status || undefined, page, limit: 30 }) });
  return (
    <div>
      <PageTitle>Заказы</PageTitle>
      <Select className="mb-4 w-auto!" aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Все статусы</option>
        {ORDER_STATUSES.map((s) => <option key={s} value={s}>{LABELS.orderStatus[s]}</option>)}
      </Select>
      {r.isError ? <ErrorState message={errorMessage(r.error)} /> : (
        <DataTable rows={r.data?.items} onRowClick={setOpen} columns={[
          { key: 'n', label: '№', render: (o) => o.number },
          { key: 'l', label: 'Товар', render: (o) => o.listing.title },
          { key: 'p', label: 'Стороны', render: (o) => `${o.buyer.displayName} → ${o.seller.displayName}` },
          { key: 's', label: 'Статус', render: (o) => <Badge>{LABELS.orderStatus[o.status]}</Badge> },
          { key: 'pay', label: 'Оплата', render: (o) => LABELS.orderPaymentStatus[o.paymentStatus] },
          { key: 't', label: 'Сумма', render: (o) => rub(o.total) },
          { key: 'd', label: 'Создан', render: (o) => dt(o.createdAt) },
        ]} />
      )}
      {r.data && <Pagination page={page} total={r.data.total} limit={30} onChange={setPage} />}
      <Modal open={!!open} onClose={() => setOpen(null)} title={`Заказ ${open?.number ?? ''}`} size="lg">
        {open && (
          <div className="space-y-3 text-sm">
            <p>{open.listing.title} · {open.quantity} шт. · {rub(open.total)} · {open.deliveryMethod === 'delivery' ? 'доставка' : 'самовывоз'}</p>
            <ol className="space-y-0.5 text-ink-600">{open.history.map((h, i) => <li key={i}>{dt(h.at)} · {LABELS.orderStatus[h.status]} · {h.actor}{h.reason ? ` · ${h.reason}` : ''}</li>)}</ol>
            {can('orders.manage') && !!open.availableActions.length && (
              <>
                <Field label="Комментарий (виден в истории)" htmlFor="or"><Textarea id="or" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <div className="flex flex-wrap gap-2">
                  {open.availableActions.filter((a) => ACT[a]).map((a) => (
                    <Button key={a} variant={a === 'cancel' ? 'danger' : 'primary'} onClick={async () => {
                      try {
                        setOpen(await api.post<OrderDto>(`/admin/orders/${open.id}/${a}`, { reason: reason || undefined }));
                        setReason('');
                        void r.refetch();
                      } catch (e) { toast(errorMessage(e), 'error'); }
                    }}>{ACT[a]}</Button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
