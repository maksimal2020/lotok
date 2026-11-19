'use client';

import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PaidServiceDto, PurchaseDto, ServiceType } from '@lotok/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { rub } from '@/lib/format';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Skeleton, useToast } from './ui';

/** Каталог платных услуг; цены, сроки и состав — из админки (без хардкода). */
export function ServicesGrid({ types, listingId, onDone }: { types: ServiceType[]; listingId?: string; onDone?: (p: PurchaseDto) => void }) {
  const { user, reload } = useAuth();
  const toast = useToast();
  const [useBonus, setUseBonus] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const idem = useMemo(() => Math.random().toString(36).slice(2, 10), []);
  const q = useQuery({ queryKey: ['services', listingId ?? ''], queryFn: () => api.get<PaidServiceDto[]>('/billing/services', listingId ? { listingId } : undefined) });
  const items = q.data?.filter((s) => types.includes(s.type)) ?? [];
  if (q.isLoading) return <div className="grid gap-3 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}</div>;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!items.length) return <EmptyState title="Услуги недоступны" />;
  const buy = async (s: PaidServiceDto) => {
    setBusy(s.code);
    try {
      const p = await api.request<PurchaseDto>('POST', '/billing/purchases', {
        body: { serviceCode: s.code, listingId, useBonus: useBonus && s.bonusAllowed },
        headers: { 'Idempotency-Key': `pur-${s.code}-${idem}` },
      });
      if (p.payment?.confirmationUrl) {
        window.location.href = p.payment.confirmationUrl;
        return;
      }
      toast('Услуга подключена');
      await reload();
      onDone?.(p);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      {!!user?.bonusBalance && (
        <div className="mb-3">
          <Checkbox label={`Списать бонусы (доступно ${rub(user.bonusBalance)})`} description="Только для услуг, где это разрешено" checked={useBonus} onChange={setUseBonus} />
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((s) => (
          <div key={s.id} className="flex flex-col rounded-2xl border-2 border-ink-100 bg-white p-5 hover:border-brand-300">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold">{s.name}</h3>
              {s.bonusAllowed && <Badge tone="brand">бонусы</Badge>}
            </div>
            <p className="mt-1 flex-1 text-sm text-ink-500">{s.description}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {s.durationDays ? <li className="flex gap-1.5"><Check className="size-4 text-brand-500" /> {s.durationDays} дн.</li> : null}
              {s.quantity ? <li className="flex gap-1.5"><Check className="size-4 text-brand-500" /> {s.quantity} шт.</li> : null}
            </ul>
            <div className="mt-4 text-2xl font-extrabold">{rub(s.price)}</div>
            <Button className="mt-3" loading={busy === s.code} disabled={!!busy || !user} onClick={() => buy(s)}>
              {user ? 'Подключить' : 'Войдите, чтобы купить'}
            </Button>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-500">Оплата проходит в тестовом режиме — реальные деньги не списываются.</p>
    </div>
  );
}
