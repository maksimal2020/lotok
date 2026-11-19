'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LABELS, VERTICALS, type CategoryAttributeDto, type CategoryDto } from '@lotok/shared';
import { Badge, Button, Checkbox, ErrorState, Field, Input, Modal, PageTitle, Select, Spinner, useConfirm, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

type Attr = { id: number; key: string; name: string; type: string };
type Edit = Partial<CategoryDto> & { slug: string; name: string; vertical: CategoryDto['vertical'] };

function AttributesPanel({ category }: { category: CategoryDto }) {
  const toast = useToast();
  const linked = useQuery({ queryKey: ['cat-attrs', category.id], queryFn: () => api.get<CategoryAttributeDto[]>(`/admin/categories/${category.id}/attributes`) });
  const all = useQuery({ queryKey: ['all-attrs'], queryFn: () => api.get<Attr[]>('/admin/attributes') });
  const [add, setAdd] = useState('');
  const [required, setRequired] = useState(false);
  const link = async (attributeId: number, opts: { isRequired: boolean; isFilterable: boolean; sort: number }) => {
    try {
      await api.put(`/admin/categories/${category.id}/attributes`, { attributeId, showInCard: true, ...opts });
      void linked.refetch();
    } catch (e) { toast(errorMessage(e), 'error'); }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-500">Характеристики наследуются дочерними категориями. Список ниже включает унаследованные.</p>
      {!linked.data ? <Spinner /> : (
        <table className="w-full text-sm">
          <thead className="text-left text-ink-500"><tr><th className="py-1">Характеристика</th><th>Обязательна</th><th>Фильтр</th><th /></tr></thead>
          <tbody>
            {linked.data.map((a) => (
              <tr key={a.id} className="border-t border-ink-100">
                <td className="py-2">{a.name} <span className="text-xs text-ink-400">{a.key} · {a.type}</span></td>
                <td><input type="checkbox" aria-label="Обязательна" checked={a.isRequired} onChange={(e) => link(a.id, { isRequired: e.target.checked, isFilterable: a.isFilterable, sort: a.sort })} /></td>
                <td><input type="checkbox" aria-label="Фильтр" checked={a.isFilterable} onChange={(e) => link(a.id, { isRequired: a.isRequired, isFilterable: e.target.checked, sort: a.sort })} /></td>
                <td className="text-right">
                  <button className="text-danger hover:underline" onClick={async () => { await api.delete(`/admin/categories/${category.id}/attributes/${a.id}`).catch((e) => toast(errorMessage(e), 'error')); void linked.refetch(); }}>Отвязать</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap items-end gap-2 border-t border-ink-100 pt-3">
        <Field label="Добавить характеристику" htmlFor="aa">
          <Select id="aa" value={add} onChange={(e) => setAdd(e.target.value)}>
            <option value="">—</option>
            {all.data?.filter((a) => !linked.data?.some((l) => l.id === a.id)).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.key})</option>)}
          </Select>
        </Field>
        <Checkbox label="Обязательная" checked={required} onChange={setRequired} />
        <Button disabled={!add} onClick={() => link(Number(add), { isRequired: required, isFilterable: true, sort: (linked.data?.length ?? 0) * 10 }).then(() => setAdd(''))}>Добавить</Button>
      </div>
    </div>
  );
}

export default function CategoriesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admin-cats'], queryFn: () => api.get<CategoryDto[]>('/admin/categories') });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [attrsFor, setAttrsFor] = useState<CategoryDto | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      const body = { parentId: edit.parentId ?? null, slug: edit.slug, name: edit.name, vertical: edit.vertical, icon: edit.icon ?? undefined, sort: edit.sort ?? 0, isActive: edit.isActive ?? true, freeListingLimit: edit.freeListingLimit ?? null, requiresManualModeration: edit.requiresManualModeration ?? false, allowDelivery: edit.allowDelivery ?? true, allowVideo: edit.allowVideo ?? false, maxPhotos: edit.maxPhotos ?? 20 };
      if (edit.id) await api.patch(`/admin/categories/${edit.id}`, body);
      else await api.post('/admin/categories', body);
      setEdit(null);
      toast('Сохранено');
      void q.refetch();
    } catch (e) { toast(errorMessage(e), 'error'); }
  };
  const render = (nodes: CategoryDto[], depth = 0): React.ReactNode =>
    nodes.map((c) => (
      <div key={c.id}>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-50 py-2" style={{ paddingLeft: depth * 24 }}>
          <span className={`font-semibold ${c.isActive ? '' : 'text-ink-400 line-through'}`}>{c.name}</span>
          <span className="text-xs text-ink-400">{c.slug} · #{c.id}</span>
          {c.freeListingLimit !== null && <Badge tone="accent">лимит {c.freeListingLimit}/30 дн.</Badge>}
          {c.requiresManualModeration && <Badge tone="warning">ручная модерация</Badge>}
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setAttrsFor(c)}>Характеристики</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit({ ...c })}>Изменить</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit({ parentId: c.id, slug: '', name: '', vertical: c.vertical })}>+ Подкатегория</Button>
            {!c.children?.length && (
              <Button size="sm" variant="ghost" className="text-danger" onClick={async () => {
                if (!(await confirm({ title: `Удалить «${c.name}»?`, danger: true, confirmText: 'Удалить' }))) return;
                await api.delete(`/admin/categories/${c.id}`).catch((e) => toast(errorMessage(e), 'error'));
                void q.refetch();
              }}>Удалить</Button>
            )}
          </span>
        </div>
        {c.children && render(c.children, depth + 1)}
      </div>
    ));
  return (
    <div>
      <PageTitle actions={<Button onClick={() => setEdit({ slug: '', name: '', vertical: 'goods', parentId: null })}>Новый раздел</Button>}>Категории</PageTitle>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : !q.data ? <Spinner /> : <div className="rounded-2xl bg-white p-4">{render(q.data)}</div>}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Категория' : 'Новая категория'} footer={<Button onClick={save}>Сохранить</Button>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название" htmlFor="cn"><Input id="cn" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Slug (латиница)" htmlFor="cs"><Input id="cs" value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></Field>
            <Field label="Раздел" htmlFor="cv">
              <Select id="cv" value={edit.vertical} onChange={(e) => setEdit({ ...edit, vertical: e.target.value as Edit['vertical'] })}>
                {VERTICALS.map((v) => <option key={v} value={v}>{LABELS.vertical[v]}</option>)}
              </Select>
            </Field>
            <Field label="Бесплатных публикаций / 30 дней (пусто — без лимита)" htmlFor="cl"><Input id="cl" type="number" min={0} value={edit.freeListingLimit ?? ''} onChange={(e) => setEdit({ ...edit, freeListingLimit: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="Макс. фото" htmlFor="cm"><Input id="cm" type="number" min={1} max={50} value={edit.maxPhotos ?? 20} onChange={(e) => setEdit({ ...edit, maxPhotos: Number(e.target.value) })} /></Field>
            <Field label="Порядок" htmlFor="co"><Input id="co" type="number" value={edit.sort ?? 0} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2">
              <Checkbox label="Активна" checked={edit.isActive ?? true} onChange={(v) => setEdit({ ...edit, isActive: v })} />
              <Checkbox label="Всегда ручная модерация" checked={edit.requiresManualModeration ?? false} onChange={(v) => setEdit({ ...edit, requiresManualModeration: v })} />
              <Checkbox label="Доставка разрешена" checked={edit.allowDelivery ?? true} onChange={(v) => setEdit({ ...edit, allowDelivery: v })} />
              <Checkbox label="Видео разрешено" checked={edit.allowVideo ?? false} onChange={(v) => setEdit({ ...edit, allowVideo: v })} />
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!attrsFor} onClose={() => setAttrsFor(null)} title={`Характеристики: ${attrsFor?.name ?? ''}`} size="lg">
        {attrsFor && <AttributesPanel category={attrsFor} />}
      </Modal>
    </div>
  );
}
