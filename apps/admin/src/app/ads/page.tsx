'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable } from '@/components/shell';
import { Alert, Badge, Button, Checkbox, ErrorState, Field, Input, Modal, PageTitle, Select, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dt } from '@/lib/fmt';

interface Ad { id?: string; slot: string; title: string; imageUrl: string; targetUrl: string; advertiser: string; advertiserInn: string; erid: string; startsAt: string; endsAt: string; isActive: boolean; impressions?: number; clicks?: number }
const SLOTS: Record<string, string> = { home_top: 'Главная, верх', search_inline: 'В выдаче', listing_sidebar: 'Карточка объявления' };
const local = (iso: string) => iso.slice(0, 16);

export default function AdsPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['ads'], queryFn: () => api.get<Ad[]>('/admin/ads') });
  const [edit, setEdit] = useState<Ad | null>(null);
  const save = async () => {
    try {
      const { id, impressions: _i, clicks: _c, ...body } = edit! as Ad & { createdAt?: string; updatedAt?: string };
      delete (body as Record<string, unknown>).createdAt;
      delete (body as Record<string, unknown>).updatedAt;
      const payload = { ...body, startsAt: new Date(body.startsAt).toISOString(), endsAt: new Date(body.endsAt).toISOString() };
      if (id) await api.patch(`/admin/ads/${id}`, payload);
      else await api.post('/admin/ads', payload);
      setEdit(null);
      void q.refetch();
    } catch (e) { toast(errorMessage(e), 'error'); }
  };
  return (
    <div>
      <PageTitle actions={<Button onClick={() => setEdit({ slot: 'home_top', title: '', imageUrl: '', targetUrl: '', advertiser: '', advertiserInn: '', erid: '', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 7 * 86400000).toISOString(), isActive: true })}>Новое размещение</Button>}>Рекламные размещения</PageTitle>
      <div className="mb-4"><Alert tone="info">Каждое размещение обязано иметь токен erid, полученный в ОРД, и данные рекламодателя (ст. 18.1 Закона «О рекламе»). Без erid сохранить нельзя.</Alert></div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : (
        <DataTable rows={q.data} onRowClick={(a) => setEdit({ ...a })} columns={[
          { key: 't', label: 'Креатив', render: (a) => <span><b>{a.title}</b><br /><span className="text-xs text-ink-400">{a.advertiser} · erid {a.erid}</span></span> },
          { key: 's', label: 'Место', render: (a) => SLOTS[a.slot] },
          { key: 'p', label: 'Период', render: (a) => `${dt(a.startsAt)} — ${dt(a.endsAt)}` },
          { key: 'm', label: 'Показы / клики', render: (a) => `${a.impressions ?? 0} / ${a.clicks ?? 0}` },
          { key: 'a', label: '', render: (a) => <Badge tone={a.isActive ? 'success' : 'neutral'}>{a.isActive ? 'вкл.' : 'выкл.'}</Badge> },
        ]} />
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Размещение" size="lg" footer={<Button onClick={save}>Сохранить</Button>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Место" htmlFor="as"><Select id="as" value={edit.slot} onChange={(e) => setEdit({ ...edit, slot: e.target.value })}>{Object.entries(SLOTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Заголовок" htmlFor="at"><Input id="at" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="URL изображения" htmlFor="ai"><Input id="ai" type="url" value={edit.imageUrl} onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })} /></Field>
            <Field label="Ссылка" htmlFor="au"><Input id="au" type="url" value={edit.targetUrl} onChange={(e) => setEdit({ ...edit, targetUrl: e.target.value })} /></Field>
            <Field label="Рекламодатель" htmlFor="aa"><Input id="aa" value={edit.advertiser} onChange={(e) => setEdit({ ...edit, advertiser: e.target.value })} /></Field>
            <Field label="ИНН рекламодателя" htmlFor="ainn"><Input id="ainn" value={edit.advertiserInn} onChange={(e) => setEdit({ ...edit, advertiserInn: e.target.value })} /></Field>
            <Field label="erid (из ОРД)" htmlFor="ae"><Input id="ae" value={edit.erid} onChange={(e) => setEdit({ ...edit, erid: e.target.value })} /></Field>
            <div />
            <Field label="Начало" htmlFor="ast"><Input id="ast" type="datetime-local" value={local(edit.startsAt)} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} /></Field>
            <Field label="Окончание" htmlFor="aen"><Input id="aen" type="datetime-local" value={local(edit.endsAt)} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} /></Field>
            <Checkbox label="Активно" checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}
