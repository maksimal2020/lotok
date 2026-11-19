'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LABELS, type ListingDetail } from '@lotok/shared';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/auth';
import { dt, rub } from '@/lib/fmt';
import { Badge, Button, Field, Modal, Spinner, Textarea, useToast } from './ui';

type AdminListing = ListingDetail & { flags: string[]; decisions: { id: number; decision: string; reason: string | null; automatic: boolean; createdAt: string }[] };

const FLAG_LABELS: Record<string, string> = {
  contacts_in_description: 'Контакты в описании',
  links_in_description: 'Ссылки в описании',
  category_manual: 'Категория с ручной проверкой',
  zero_price: 'Нулевая цена',
  price_anomaly: 'Подозрительная цена',
  new_user: 'Новый пользователь',
  recent_blocks: 'Недавние блокировки',
  complaints_threshold: 'Много жалоб',
};

export const flagLabel = (f: string) => FLAG_LABELS[f] ?? (f.startsWith('stop_word:') ? `Стоп-слово «${f.slice(10)}»` : f);

/** Карточка объявления для модератора: фото, текст, характеристики, история решений, действия. */
export function ListingReview({ id, onClose, onDone }: { id: string | null; onClose: () => void; onDone: () => void }) {
  const { can } = useAdmin();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin-listing', id], queryFn: () => api.get<AdminListing>(`/admin/listings/${id}`), enabled: !!id });
  const decide = async (decision: 'approve' | 'reject' | 'block') => {
    setBusy(decision);
    try {
      await api.post(`/admin/listings/${id}/moderate`, { decision, reason: reason || undefined });
      toast(decision === 'approve' ? 'Одобрено' : decision === 'reject' ? 'Отклонено' : 'Заблокировано');
      setReason('');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const l = q.data;
  return (
    <Modal open={!!id} onClose={onClose} title="Проверка объявления" size="lg"
      footer={l && (
        <>
          {l.status === 'blocked' && can('listings.block') && <Button variant="outline" onClick={async () => { await api.post(`/admin/listings/${id}/unblock`); onDone(); }}>Разблокировать</Button>}
          {['moderation', 'active', 'inactive', 'rejected'].includes(l.status) && can('listings.block') && <Button variant="danger" loading={busy === 'block'} onClick={() => decide('block')}>Заблокировать</Button>}
          {l.status === 'moderation' && (
            <>
              <Button variant="outline" loading={busy === 'reject'} onClick={() => decide('reject')}>Отклонить</Button>
              <Button loading={busy === 'approve'} onClick={() => decide('approve')}>Одобрить</Button>
            </>
          )}
        </>
      )}
    >
      {!l ? <Spinner /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{LABELS.listingStatus[l.status]}</Badge>
            {l.flags.map((f) => <Badge key={f} tone="warning">{flagLabel(f)}</Badge>)}
          </div>
          <div>
            <h3 className="break-anywhere text-xl font-bold">{l.title}</h3>
            <div className="text-lg font-extrabold">{l.price !== null ? rub(l.price) : LABELS.priceType[l.priceType]}</div>
            <div className="text-sm text-ink-500">{l.category.path.map((p) => p.name).join(' › ')} · {l.cityName} · продавец {l.seller.displayName}</div>
          </div>
          {!!l.photos.length && (
            <div className="flex gap-2 overflow-x-auto">
              {l.photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <a key={p.id} href={p.urls.large ?? '#'} target="_blank" rel="noreferrer"><img src={p.urls.thumb ?? ''} alt="" className="h-28 rounded-lg object-cover" /></a>
              ))}
            </div>
          )}
          <p className="whitespace-pre-line break-anywhere rounded-xl bg-ink-50 p-3 text-sm">{l.description || '— без описания —'}</p>
          {!!l.attributes.length && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {l.attributes.map((a) => (
                <div key={a.key} className="contents"><dt className="text-ink-500">{a.name}</dt><dd>{a.display}</dd></div>
              ))}
            </dl>
          )}
          {l.rejectionReason && <p className="text-sm text-danger">Причина последнего отказа: {l.rejectionReason}</p>}
          <Field label="Причина (обязательна для отклонения и блокировки; увидит автор)" htmlFor="mr">
            <Textarea id="mr" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div>
            <div className="mb-1 text-sm font-semibold">История решений</div>
            <ul className="space-y-1 text-sm text-ink-600">
              {l.decisions.map((d) => <li key={d.id}>{dt(d.createdAt)} · {d.automatic ? 'авто' : 'модератор'} · {d.decision}{d.reason ? ` · ${d.reason}` : ''}</li>)}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
