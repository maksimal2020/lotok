'use client';

import { useQuery } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { Alert, Button, Card, ErrorState, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { rub } from '@/lib/format';

interface MockInfo {
  providerPaymentId: string;
  status: string;
  amount: number;
  description: string;
  paymentId: string | null;
  purpose?: 'order' | 'service';
  orderId?: string | null;
  purchaseId?: string | null;
}

/**
 * Страница ТЕСТОВОГО платёжного провайдера. В production пользователь попадает на страницу настоящего провайдера (ЮKassa и т.п.).
 * Здесь нет полей для данных карты: платформа их не принимает и не хранит.
 */
export default function TestPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['mockpay', id], queryFn: () => api.get<MockInfo>(`/payments/test/${id}`) });
  const back = (info: MockInfo) => (info.purpose === 'order' && info.orderId ? `/orders/${info.orderId}` : '/payments');
  if (q.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (q.isError) return <div className="container-page py-10"><ErrorState message={errorMessage(q.error)} /></div>;
  const info = q.data!;
  const act = async (outcome: 'succeeded' | 'canceled') => {
    setBusy(outcome);
    setError(null);
    try {
      await api.post(`/payments/test/${id}/complete`, { outcome });
      await new Promise((r) => setTimeout(r, 600));
      router.replace(back(info));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card className="space-y-4">
        <div className="flex items-center gap-2 rounded-xl bg-accent-100 px-3 py-2 text-sm font-bold text-accent-700">
          <FlaskConical className="size-4" /> ТЕСТОВЫЙ РЕЖИМ — деньги не списываются
        </div>
        <h1 className="text-xl font-extrabold">Оплата</h1>
        <p className="text-ink-700">{info.description}</p>
        <div className="text-3xl font-extrabold">{rub(info.amount)}</div>
        {error && <Alert tone="danger">{error}</Alert>}
        {info.status === 'pending' ? (
          <div className="flex flex-col gap-2">
            <Button size="lg" loading={busy === 'succeeded'} disabled={!!busy} onClick={() => act('succeeded')}>
              Оплатить (тест)
            </Button>
            <Button variant="outline" loading={busy === 'canceled'} disabled={!!busy} onClick={() => act('canceled')}>
              Отказаться от оплаты
            </Button>
          </div>
        ) : (
          <Alert tone="info">
            Платёж уже обработан ({info.status}). <a href={back(info)} className="font-bold underline">Вернуться</a>
          </Alert>
        )}
        <p className="text-xs text-ink-500">Имитация внешнего провайдера: после действия он отправит подписанное уведомление (webhook) на сервер Лотка.</p>
      </Card>
    </div>
  );
}
