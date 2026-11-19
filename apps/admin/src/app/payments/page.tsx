'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LABELS, PAYMENT_STATUSES, type Paginated, type PaymentDto } from '@lotok/shared';
import { DataTable } from '@/components/shell';
import { Alert, Badge, Button, Card, ErrorState, Field, Input, Modal, PageTitle, Pagination, Select, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/auth';
import { dt, rub, short } from '@/lib/fmt';

type Row = PaymentDto & { userId: string; providerPaymentId: string | null };
const ACCOUNT: Record<string, string> = {
  provider_clearing: 'У платёжного провайдера',
  platform_revenue: 'Выручка платформы',
  seller_payable: 'Обязательства перед продавцами',
  user_bonus: 'Бонусы пользователей',
  bonus_issued: 'Выпущенные бонусы',
  refunds: 'Возвраты',
};

export default function PaymentsPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [refund, setRefund] = useState<Row | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const r = useQuery({ queryKey: ['admin-payments', status, page], queryFn: () => api.get<Paginated<Row>>('/admin/payments', { status: status || undefined, page, limit: 30 }) });
  const tb = useQuery({ queryKey: ['trial'], queryFn: () => api.get<{ byType: Record<string, number>; balanced: boolean }>('/admin/ledger/trial-balance') });
  return (
    <div>
      <PageTitle>Платежи</PageTitle>
      {tb.data && (
        <Card className="mb-5">
          <div className="mb-2 flex items-center gap-2 font-bold">Баланс счетов {tb.data.balanced ? <Badge tone="success">сходится</Badge> : <Badge tone="danger">РАСХОЖДЕНИЕ</Badge>}</div>
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            {Object.entries(tb.data.byType).map(([k, v]) => (
              <div key={k}><div className="text-ink-500">{ACCOUNT[k] ?? k}</div><div className="font-bold">{rub(Math.abs(v))}</div></div>
            ))}
          </div>
        </Card>
      )}
      <Select className="mb-4 w-auto!" aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Все статусы</option>
        {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{LABELS.paymentStatus[s]}</option>)}
      </Select>
      {r.isError ? <ErrorState message={errorMessage(r.error)} /> : (
        <DataTable rows={r.data?.items} columns={[
          { key: 'd', label: 'Дата', render: (p) => dt(p.createdAt) },
          { key: 'n', label: 'Назначение', render: (p) => <span>{p.description}<br /><span className="text-xs text-ink-400">{p.provider} {p.providerPaymentId && short(p.providerPaymentId)} {p.testMode && '· тест'}</span></span> },
          { key: 'a', label: 'Сумма', render: (p) => <span>{rub(p.amount)}{p.refundedAmount ? <><br /><span className="text-xs text-danger">возврат {rub(p.refundedAmount)}</span></> : null}</span> },
          { key: 's', label: 'Статус', render: (p) => <Badge tone={p.status === 'succeeded' ? 'success' : 'neutral'}>{LABELS.paymentStatus[p.status]}</Badge> },
          { key: 'x', label: '', render: (p) => can('payments.refund') && ['succeeded', 'partially_refunded'].includes(p.status) && <Button size="sm" variant="outline" onClick={() => setRefund(p)}>Возврат</Button> },
        ]} />
      )}
      {r.data && <Pagination page={page} total={r.data.total} limit={30} onChange={setPage} />}
      <Modal open={!!refund} onClose={() => setRefund(null)} title="Возврат платежа"
        footer={<Button variant="danger" disabled={!reason} onClick={async () => {
          try {
            await api.post(`/admin/payments/${refund!.id}/refund`, { amount: amount ? Math.round(Number(amount) * 100) : undefined, reason });
            toast('Возврат выполнен');
            setRefund(null); setAmount(''); setReason('');
            void r.refetch(); void tb.refetch();
          } catch (e) { toast(errorMessage(e), 'error'); }
        }}>Вернуть</Button>}
      >
        {refund && (
          <div className="space-y-3">
            <Alert tone="info">Доступно к возврату: {rub(refund.amount - refund.refundedAmount)}. Пустая сумма — полный возврат остатка.</Alert>
            <Field label="Сумма, ₽" htmlFor="ra"><Input id="ra" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Причина" htmlFor="rr"><Input id="rr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
