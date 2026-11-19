'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorState, Input, PageTitle, Select, Spinner, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/auth';

const LABELS: Record<string, string> = {
  'listings.ttl_days': 'Срок размещения объявления, дней',
  'listings.default_free_limit': 'Лимит бесплатных публикаций по умолчанию (пусто — без лимита)',
  'listings.new_user_manual_moderation_hours': 'Новый аккаунт (часов) — признак для модерации',
  'orders.commission_bp': 'Комиссия с онлайн-заказов, б.п. (500 = 5%)',
  'orders.auto_complete_days': 'Автозавершение доставленного заказа, дней',
  'orders.unpaid_cancel_minutes': 'Отмена неоплаченного заказа, минут',
  'complaints.auto_remoderate_threshold': 'Жалоб до автоматической повторной модерации',
  'reviews.require_completed_order': 'Отзывы только после завершённого заказа',
  'chat.max_messages_per_minute': 'Лимит сообщений в минуту на пользователя',
  'bonus.welcome_amount': 'Приветственный бонус, коп.',
  'platform.maintenance': 'Режим обслуживания',
};

function SettingRow({ k, value, onSaved }: { k: string; value: unknown; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(value === null ? '' : String(value));
  useEffect(() => {
    setV(value === null ? '' : String(value));
  }, [value]);
  const isBool = typeof value === 'boolean';
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{LABELS[k] ?? k}</div>
        <div className="text-xs text-ink-400">{k}</div>
      </div>
      {isBool ? (
        <Select className="w-auto!" value={v} onChange={(e) => setV(e.target.value)} aria-label={k}><option value="true">Да</option><option value="false">Нет</option></Select>
      ) : (
        <Input className="w-32" type="number" value={v} onChange={(e) => setV(e.target.value)} aria-label={k} />
      )}
      <Button size="sm" variant="outline" onClick={async () => {
        try {
          const val = isBool ? v === 'true' : v === '' ? null : Number(v);
          await api.put(`/admin/settings/${k}`, { value: val });
          toast('Сохранено');
          onSaved();
        } catch (e) { toast(errorMessage(e), 'error'); }
      }}>Сохранить</Button>
    </div>
  );
}

function StopWords() {
  const { can } = useAdmin();
  const toast = useToast();
  const q = useQuery({ queryKey: ['stopwords'], queryFn: () => api.get<{ id: number; word: string; action: string }[]>('/admin/stop-words'), enabled: can('moderation.rules') });
  const [word, setWord] = useState('');
  const [action, setAction] = useState('flag');
  if (!can('moderation.rules')) return null;
  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Стоп-слова автомодерации</h2>
      <p className="mb-3 text-sm text-ink-500">«Отклонить» — объявление отклоняется автоматически; «На проверку» — отправляется модератору.</p>
      <form className="mb-3 flex flex-wrap gap-2" onSubmit={async (e) => {
        e.preventDefault();
        try { await api.post('/admin/stop-words', { word, action }); setWord(''); void q.refetch(); } catch (err) { toast(errorMessage(err), 'error'); }
      }}>
        <Input className="max-w-xs" placeholder="слово или фраза" value={word} onChange={(e) => setWord(e.target.value)} />
        <Select className="w-auto!" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Действие"><option value="flag">На проверку</option><option value="reject">Отклонить</option></Select>
        <Button type="submit">Добавить</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {q.data?.map((w) => (
          <span key={w.id} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-sm ${w.action === 'reject' ? 'bg-danger/10 text-danger' : 'bg-accent-50 text-accent-700'}`}>
            {w.word}
            <button aria-label={`Удалить ${w.word}`} onClick={async () => { await api.delete(`/admin/stop-words/${w.id}`); void q.refetch(); }}>×</button>
          </span>
        ))}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, unknown>>('/admin/settings') });
  const sys = useQuery({ queryKey: ['system'], queryFn: () => api.get<{ queues: Record<string, Record<string, number>> }>('/admin/system') });
  const [busy, setBusy] = useState(false);
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  return (
    <div className="space-y-5">
      <PageTitle>Настройки платформы</PageTitle>
      <Card>{!q.data ? <Spinner /> : Object.entries(q.data).map(([k, v]) => <SettingRow key={k} k={k} value={v} onSaved={() => q.refetch()} />)}</Card>
      <StopWords />
      <Card>
        <h2 className="mb-2 text-lg font-bold">Поиск и очереди</h2>
        <Button variant="outline" loading={busy} onClick={async () => {
          setBusy(true);
          try { const r = await api.post<{ indexed: number; engine: string }>('/admin/search/reindex'); toast(`Переиндексировано: ${r.indexed} (${r.engine})`); } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
        }}>Переиндексировать объявления</Button>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-ink-50 p-3 text-xs">{JSON.stringify(sys.data?.queues ?? {}, null, 2)}</pre>
      </Card>
    </div>
  );
}
