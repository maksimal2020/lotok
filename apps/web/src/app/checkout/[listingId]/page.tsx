'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useMemo, useState } from 'react';
import type { DeliveryQuote, ListingDetail, OrderDto } from '@lotok/shared';
import { Alert, Button, Card, Checkbox, ErrorState, Field, Input, PageTitle, Spinner, Textarea } from '@/components/ui';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { priceLabel, rub } from '@/lib/format';

export default function CheckoutPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = use(params);
  const { user } = useRequireAuth();
  const router = useRouter();
  const listing = useQuery({ queryKey: ['listing', listingId, 'checkout'], queryFn: () => api.get<ListingDetail>(`/listings/${listingId}`), enabled: !!user });
  const [method, setMethod] = useState<'pickup' | 'delivery'>('pickup');
  const [payOnline, setPayOnline] = useState(true);
  const [qty, setQty] = useState(1);
  const [addr, setAddr] = useState({ recipientName: user?.displayName ?? '', recipientPhone: user?.phone ?? '', city: '', address: '', comment: '' });
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ключ идемпотентности: повторное нажатие/повтор запроса не создаст второй заказ.
  const idemKey = useMemo(() => `ord-${listingId.slice(0, 8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, [listingId]);
  const quote = useQuery({
    queryKey: ['quote', listingId, addr.city],
    queryFn: () => api.get<DeliveryQuote[]>('/orders/delivery/quote', { listingId, city: addr.city }),
    enabled: method === 'delivery' && addr.city.trim().length >= 2,
  });

  if (!user || listing.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (listing.isError) return <div className="container-page py-10"><ErrorState message={errorMessage(listing.error)} /></div>;
  const l = listing.data!;
  if (!l.canBuy) return <div className="container-page py-10"><Alert tone="warning">Этот товар нельзя купить онлайн. Напишите продавцу в чате.</Alert></div>;
  const delivery = method === 'delivery' ? (quote.data?.[0]?.price ?? 0) : 0;
  const total = (l.price ?? 0) * qty + delivery;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const o = await api.request<OrderDto>('POST', '/orders', {
        body: {
          listingId,
          quantity: qty,
          deliveryMethod: method,
          deliveryProvider: method === 'delivery' ? quote.data?.[0]?.provider : undefined,
          deliveryAddress: method === 'delivery' ? { ...addr, comment: addr.comment || undefined } : undefined,
          payOnline: method === 'delivery' ? true : payOnline,
          comment: comment || undefined,
        },
        headers: { 'Idempotency-Key': idemKey },
      });
      if (o.payment?.confirmationUrl) window.location.href = o.payment.confirmationUrl;
      else router.push(`/orders/${o.id}`);
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container-page max-w-4xl py-6">
      <PageTitle>Оформление заказа</PageTitle>
      <div className="grid gap-5 md:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <Card>
            <h2 className="mb-3 font-bold">Способ получения</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['pickup', 'delivery'] as const).filter((m) => m === 'pickup' || l.deliveryAvailable).map((m) => (
                <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`rounded-xl border-2 p-4 text-left ${method === m ? 'border-brand-500 bg-brand-50' : 'border-ink-200'}`}>
                  <div className="font-bold">{m === 'pickup' ? 'Самовывоз' : 'Доставка'}</div>
                  <div className="text-sm text-ink-500">{m === 'pickup' ? `${l.cityName}${l.address ? `, ${l.address}` : ''}` : 'Тестовая служба доставки'}</div>
                </button>
              ))}
            </div>
          </Card>
          {method === 'delivery' ? (
            <Card>
              <h2 className="mb-3 font-bold">Получатель и адрес</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Имя получателя" htmlFor="rn" error={errors['deliveryAddress.recipientName']} required>
                  <Input id="rn" autoComplete="name" value={addr.recipientName} onChange={(e) => setAddr({ ...addr, recipientName: e.target.value })} />
                </Field>
                <Field label="Телефон" htmlFor="rp" error={errors['deliveryAddress.recipientPhone']} required>
                  <Input id="rp" type="tel" autoComplete="tel" value={addr.recipientPhone} onChange={(e) => setAddr({ ...addr, recipientPhone: e.target.value })} />
                </Field>
                <Field label="Город" htmlFor="rc" error={errors['deliveryAddress.city']} required>
                  <Input id="rc" autoComplete="address-level2" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
                </Field>
                <Field label="Адрес" htmlFor="ra" error={errors['deliveryAddress.address']} required>
                  <Input id="ra" autoComplete="street-address" value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} />
                </Field>
              </div>
              {quote.data?.[0] && (
                <p className="mt-3 text-sm text-ink-600">
                  {quote.data[0].providerName}: {rub(quote.data[0].price)}, {quote.data[0].daysMin}–{quote.data[0].daysMax} дн.
                  {quote.data[0].testMode && ' (тестовый тариф)'}
                </p>
              )}
            </Card>
          ) : (
            <Card>
              <h2 className="mb-2 font-bold">Оплата</h2>
              <Checkbox label="Оплатить онлайн сейчас" description="Иначе — оплата продавцу при встрече" checked={payOnline} onChange={setPayOnline} />
            </Card>
          )}
          <Card>
            <Field label="Комментарий продавцу" htmlFor="oc">
              <Textarea id="oc" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          </Card>
        </div>
        <aside>
          <Card className="space-y-3 md:sticky md:top-24">
            <div className="flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {l.photo?.thumb && <img src={l.photo.thumb} alt="" className="size-16 rounded-lg object-cover" />}
              <div className="min-w-0">
                <div className="line-clamp-2 font-semibold">{l.title}</div>
                <div className="text-sm text-ink-500">{priceLabel(l)}</div>
              </div>
            </div>
            {l.quantity > 1 && (
              <Field label="Количество" htmlFor="q">
                <Input id="q" type="number" min={1} max={l.quantity} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(l.quantity, Number(e.target.value) || 1)))} />
              </Field>
            )}
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt>Товар</dt><dd>{rub((l.price ?? 0) * qty)}</dd></div>
              <div className="flex justify-between"><dt>Доставка</dt><dd>{rub(delivery)}</dd></div>
              <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-extrabold"><dt>Итого</dt><dd>{rub(total)}</dd></div>
            </dl>
            <Button block size="lg" loading={busy} onClick={submit} disabled={method === 'delivery' && !quote.data?.length}>
              {method === 'delivery' || payOnline ? 'Перейти к оплате' : 'Оформить заказ'}
            </Button>
            <p className="text-xs text-ink-500">Платежи работают в тестовом режиме: реальные деньги не списываются. Данные карты вводятся только на странице платёжного провайдера.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
