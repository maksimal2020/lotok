'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { REGION_TYPES } from '@lotok/shared';
import { DataTable } from '@/components/shell';
import { Badge, Button, Checkbox, ErrorState, Field, Input, Modal, PageTitle, Select, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

interface Region { id: number; parentId: number | null; type: string; name: string; slug: string; lat: number | null; lng: number | null; sort: number; isActive: boolean }
const TYPE: Record<string, string> = { country: 'Страна', region: 'Субъект', city: 'Город', district: 'Район' };

export default function RegionsPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-regions'], queryFn: () => api.get<Region[]>('/admin/regions') });
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState<Partial<Region> | null>(null);
  const rows = q.data?.filter((r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()));
  const parentName = (id: number | null) => q.data?.find((r) => r.id === id)?.name ?? '';
  const save = async () => {
    try {
      const { id, ...body } = edit!;
      const payload = { parentId: body.parentId ?? null, type: body.type ?? 'city', name: body.name ?? '', slug: body.slug ?? '', lat: body.lat ?? null, lng: body.lng ?? null, sort: body.sort ?? 10, isActive: body.isActive ?? true };
      if (id) await api.patch(`/admin/regions/${id}`, payload);
      else await api.post('/admin/regions', payload);
      setEdit(null);
      void q.refetch();
    } catch (e) { toast(errorMessage(e), 'error'); }
  };
  return (
    <div>
      <PageTitle actions={<Button onClick={() => setEdit({ type: 'city', isActive: true, sort: 10 })}>Добавить</Button>}>Регионы и города</PageTitle>
      <Input className="mb-4 max-w-xs" placeholder="Поиск" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : (
        <DataTable rows={rows} onRowClick={(r) => setEdit(r)} columns={[
          { key: 'n', label: 'Название', render: (r) => <b className={r.isActive ? '' : 'text-ink-400'}>{r.name}</b> },
          { key: 't', label: 'Тип', render: (r) => <Badge>{TYPE[r.type]}</Badge> },
          { key: 'p', label: 'Входит в', render: (r) => parentName(r.parentId) },
          { key: 'c', label: 'Координаты', render: (r) => (r.lat ? `${r.lat.toFixed(3)}, ${r.lng?.toFixed(3)}` : '') },
        ]} />
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Регион" footer={<Button onClick={save}>Сохранить</Button>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название" htmlFor="rn"><Input id="rn" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Slug" htmlFor="rs"><Input id="rs" value={edit.slug ?? ''} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></Field>
            <Field label="Тип" htmlFor="rt"><Select id="rt" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{REGION_TYPES.map((t) => <option key={t} value={t}>{TYPE[t]}</option>)}</Select></Field>
            <Field label="Входит в" htmlFor="rp">
              <Select id="rp" value={edit.parentId ?? ''} onChange={(e) => setEdit({ ...edit, parentId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {q.data?.filter((r) => r.type !== 'district' && r.id !== edit.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label="Широта" htmlFor="rla"><Input id="rla" type="number" step="any" value={edit.lat ?? ''} onChange={(e) => setEdit({ ...edit, lat: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Долгота" htmlFor="rlo"><Input id="rlo" type="number" step="any" value={edit.lng ?? ''} onChange={(e) => setEdit({ ...edit, lng: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Порядок (меньше 100 — популярный город)" htmlFor="ro"><Input id="ro" type="number" value={edit.sort ?? 10} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} /></Field>
            <Checkbox label="Активен" checked={edit.isActive ?? true} onChange={(v) => setEdit({ ...edit, isActive: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}
