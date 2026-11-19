'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SERVICE_TYPES, type PaidServiceDto } from '@lotok/shared';
import { DataTable } from '@/components/shell';
import { Badge, Button, Checkbox, ErrorState, Field, Input, Modal, PageTitle, Select, Textarea, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { rub } from '@/lib/fmt';

const TYPE_LABEL: Record<string, string> = {
  bump: 'Поднятие',
  highlight: 'Выделение',
  premium: 'Премиум',
  listing_slot: 'Доп. публикация',
  listing_package: 'Пакет публикаций',
  pro_subscription: 'PRO-подписка',
  analytics: 'Расширенная статистика',
};
const EMPTY = { code: '', type: 'bump', name: '', description: '', price: 0, durationDays: null as number | null, quantity: null as number | null, categoryId: null as number | null, isActive: true, bonusAllowed: false, sort: 0 };

export default function ServicesPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-services'], queryFn: () => api.get<PaidServiceDto[]>('/admin/services') });
  const [edit, setEdit] = useState<(typeof EMPTY & { id?: number }) | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      const { id, ...body } = edit;
      if (id) await api.patch(`/admin/services/${id}`, body);
      else await api.post('/admin/services', body);
      toast('Сохранено');
      setEdit(null);
      void q.refetch();
    } catch (e) { toast(errorMessage(e), 'error'); }
  };
  return (
    <div>
      <PageTitle actions={<Button onClick={() => setEdit({ ...EMPTY })}>Добавить услугу</Button>}>Тарифы и платные услуги</PageTitle>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : (
        <DataTable rows={q.data} onRowClick={(s) => setEdit({ ...s })} columns={[
          { key: 'n', label: 'Услуга', render: (s) => <span><b>{s.name}</b><br /><span className="text-xs text-ink-400">{s.code}</span></span> },
          { key: 't', label: 'Тип', render: (s) => TYPE_LABEL[s.type] },
          { key: 'p', label: 'Цена', render: (s) => rub(s.price) },
          { key: 'd', label: 'Срок / кол-во', render: (s) => `${s.durationDays ?? '—'} дн. / ${s.quantity ?? '—'}` },
          { key: 'a', label: 'Статус', render: (s) => <Badge tone={s.isActive ? 'success' : 'neutral'}>{s.isActive ? 'активна' : 'выключена'}</Badge> },
        ]} />
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Редактирование услуги' : 'Новая услуга'} footer={<Button onClick={save}>Сохранить</Button>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Код" htmlFor="sc"><Input id="sc" value={edit.code} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Тип" htmlFor="st">
              <Select id="st" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                {SERVICE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2"><Field label="Название" htmlFor="sn"><Input id="sn" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field></div>
            <div className="sm:col-span-2"><Field label="Описание" htmlFor="sd"><Textarea id="sd" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field></div>
            <Field label="Цена, ₽" htmlFor="sp"><Input id="sp" type="number" min={0} step="0.01" value={edit.price / 100} onChange={(e) => setEdit({ ...edit, price: Math.round(Number(e.target.value) * 100) })} /></Field>
            <Field label="Срок, дней" htmlFor="sdd"><Input id="sdd" type="number" min={0} value={edit.durationDays ?? ''} onChange={(e) => setEdit({ ...edit, durationDays: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Количество" htmlFor="sq"><Input id="sq" type="number" min={1} value={edit.quantity ?? ''} onChange={(e) => setEdit({ ...edit, quantity: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="ID категории (пусто — все)" htmlFor="scat"><Input id="scat" type="number" value={edit.categoryId ?? ''} onChange={(e) => setEdit({ ...edit, categoryId: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Порядок" htmlFor="so"><Input id="so" type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2">
              <Checkbox label="Активна" checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} />
              <Checkbox label="Можно оплатить бонусами" checked={edit.bonusAllowed} onChange={(v) => setEdit({ ...edit, bonusAllowed: v })} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
