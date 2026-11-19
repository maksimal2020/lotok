'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { LABELS, type OrderDto } from '@lotok/shared';
import { Alert, Badge, Button, Card, ErrorState, Field, Input, Modal, PageTitle, Spinner, Textarea, useConfirm, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { dateTime, rub } from '@/lib/format';
import { useSocket } from '@/lib/socket';

const ACTION_LABELS: Record<string, string> = {
  confirm: 'Подтвердить заказ',
  ship: 'Отметить отправку',
  deliver: 'Отметить доставку',
  complete: 'Подтвердить получение',
  cancel: 'Отменить заказ',
  request_refund: 'Запросить возврат',
  approve_refund: 'Одобрить возврат',
};

function ReviewForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Card>
      <h2 className="mb-3 font-bold">Оставьте отзыв</h2>
      <div className="mb-3 flex gap-1" role="radiogroup" aria-label="Оценка">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} из 5`} onClick={() => setRating(n)} className={`text-3xl ${n <= rating ? 'text-accent-500' : 'text-ink-200'}`}>
            ★
          </button>
        ))}
      </div>
      <Textarea aria-label="Текст отзыва" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Как прошла сделка?" />
      <Button
        className="mt-3"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post('/reviews', { orderId, rating, text });
            toast('Спасибо за отзыв!');
            onDone();
          } catch (e) {
            toast(errorMessage(e), 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        Отправить отзыв
      </Button>
    </Card>
  );
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useRequireAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.get<OrderDto>(`/orders/${id}`), enabled: !!user });
  const [dialog, setDialog] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);

  const socket = useSocket();
  useEffect(() => {
    const s = socket;
    if (!s) return;
    const h = (e: { orderId: string }) => {
      if (e.orderId === id) void q.refetch();
    };
    s.on('order:updated', h);
    return () => {
      s.off('order:updated', h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, socket]);

  // После возврата со страницы оплаты сверяем статус с провайдером.
  useEffect(() => {
    if (q.data?.payment?.status === 'pending') {
      const t = setTimeout(() => void api.post(`/payments/${q.data!.payment!.id}/sync`).then(() => q.refetch()).catch(() => undefined), 1500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.payment?.status]);

  if (!user || q.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (q.isError) return <div className="container-page py-10"><ErrorState message={errorMessage(q.error)} /></div>;
  const o = q.data!;

  const run = async (action: string) => {
    setBusy(true);
    try {
      await api.post(`/orders/${id}/${action}`, { reason: reason || undefined, trackingNumber: tracking || undefined });
      setDialog(null);
      setReason('');
      toast('Статус заказа обновлён');
      void q.refetch();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page max-w-4xl py-6">
      <PageTitle>Заказ № {o.number}</PageTitle>
      <div className="grid gap-5 md:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <Badge tone="brand" className="text-sm">{LABELS.orderStatus[o.status]}</Badge>
              <span className="text-sm text-ink-500">{LABELS.orderPaymentStatus[o.paymentStatus]}</span>
            </div>
            <Link href={`/listing/${o.listing.id}`} className="mt-4 flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {o.listing.photo?.thumb && <img src={o.listing.photo.thumb} alt="" className="size-20 rounded-xl object-cover" />}
              <div>
                <div className="font-bold hover:text-brand-600">{o.listing.title}</div>
                <div className="text-sm text-ink-500">{o.quantity} шт. × {rub(o.itemPrice)}</div>
              </div>
            </Link>
            {o.payment?.status === 'pending' && o.payment.confirmationUrl && (
              <div className="mt-4">
                <Alert tone="warning">
                  Заказ ожидает оплаты. <a href={o.payment.confirmationUrl} className="font-bold underline">Перейти к оплате</a>
                  {o.payment.testMode && ' (тестовый режим)'}
                </Alert>
              </div>
            )}
            {o.trackingNumber && <p className="mt-3 text-sm">Трек-номер: <b>{o.trackingNumber}</b></p>}
            {o.deliveryAddress && (
              <p className="mt-2 text-sm text-ink-600">
                Доставка: {String(o.deliveryAddress.city)}, {String(o.deliveryAddress.address)} · {String(o.deliveryAddress.recipientName)}, {String(o.deliveryAddress.recipientPhone)}
              </p>
            )}
            {o.comment && <p className="mt-2 text-sm text-ink-600">Комментарий: {o.comment}</p>}
          </Card>
          {!!o.availableActions.length && (
            <Card className="flex flex-wrap gap-2">
              {o.availableActions.map((a) => (
                <Button
                  key={a}
                  variant={a === 'cancel' || a === 'request_refund' ? 'outline' : 'primary'}
                  onClick={async () => {
                    if (a === 'cancel' || a === 'request_refund' || a === 'ship') return setDialog(a);
                    if (await confirm({ title: `${ACTION_LABELS[a]}?` })) void run(a);
                  }}
                >
                  {ACTION_LABELS[a] ?? a}
                </Button>
              ))}
            </Card>
          )}
          {o.canReview && <ReviewForm orderId={o.id} onDone={() => q.refetch()} />}
          <Card>
            <h2 className="mb-3 font-bold">История</h2>
            <ol className="space-y-3">
              {o.history.map((h, i) => (
                <li key={i} className="flex gap-3">
                  {i === o.history.length - 1 ? <CheckCircle2 className="size-5 shrink-0 text-brand-500" /> : <Circle className="size-5 shrink-0 text-ink-300" />}
                  <div>
                    <div className="font-semibold">{LABELS.orderStatus[h.status]}</div>
                    <div className="text-sm text-ink-500">{dateTime(h.at)}{h.reason ? ` · ${h.reason}` : ''}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <aside>
          <Card className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Товар</span><span>{rub(o.itemPrice * o.quantity)}</span></div>
            <div className="flex justify-between"><span>Доставка</span><span>{rub(o.deliveryPrice)}</span></div>
            {'commission' in o && o.role === 'seller' && <div className="flex justify-between text-ink-500"><span>Комиссия сервиса</span><span>−{rub((o as OrderDto & { commission: number }).commission)}</span></div>}
            <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-extrabold"><span>Итого</span><span>{rub(o.total)}</span></div>
            <div className="pt-3 text-ink-500">Продавец: {o.seller.displayName}<br />Покупатель: {o.buyer.displayName}</div>
            {o.role === 'seller' && o.paymentStatus === 'paid' && (
              <p className="pt-2 text-xs text-ink-500">Тестовый режим: выплата продавцу не производится. Сумма учтена на счёте обязательств перед продавцом.</p>
            )}
          </Card>
        </aside>
      </div>
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog ? ACTION_LABELS[dialog] : ''}
        footer={<Button loading={busy} variant={dialog === 'ship' ? 'primary' : 'danger'} onClick={() => dialog && run(dialog)}>Подтвердить</Button>}
      >
        {dialog === 'ship' ? (
          <Field label="Трек-номер (необязательно)" htmlFor="tn" hint="Если не указать, номер выдаст служба доставки">
            <Input id="tn" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </Field>
        ) : (
          <Field label="Причина" htmlFor="rs">
            <Textarea id="rs" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {dialog === 'cancel' && o.paymentStatus === 'paid' && <p className="mt-3 text-sm text-ink-500">Оплаченная сумма будет возвращена покупателю автоматически.</p>}
      </Modal>
    </div>
  );
}
