'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ATTRIBUTE_TYPES } from '@lotok/shared';
import { DataTable } from '@/components/shell';
import { Button, ErrorState, Field, Input, Modal, PageTitle, Select, Textarea, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

interface Attr {
  id: number;
  key: string;
  name: string;
  type: string;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  dependsOnAttributeId: number | null;
  options: { value: string; label: string; parentValue: string | null }[];
}

const TYPE_LABEL: Record<string, string> = { string: 'Строка', integer: 'Целое', decimal: 'Дробное', boolean: 'Да/нет', enum: 'Список', multi_enum: 'Множественный выбор', year: 'Год' };

export default function AttributesPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['all-attrs'], queryFn: () => api.get<Attr[]>('/admin/attributes') });
  const [edit, setEdit] = useState<(Omit<Attr, 'id' | 'options'> & { id?: number; optionsText: string }) | null>(null);
  const open = (a?: Attr) =>
    setEdit(
      a
        ? { ...a, optionsText: a.options.map((o) => [o.value, o.label, o.parentValue].filter(Boolean).join(' | ')).join('\n') }
        : { key: '', name: '', type: 'enum', unit: null, minValue: null, maxValue: null, dependsOnAttributeId: null, optionsText: '' },
    );
  const save = async () => {
    if (!edit) return;
    const options = ['enum', 'multi_enum'].includes(edit.type)
      ? edit.optionsText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const [value, label, parentValue] = l.split('|').map((x) => x.trim());
          return { value, label: label ?? value, ...(parentValue ? { parentValue } : {}) };
        })
      : undefined;
    try {
      const body = { key: edit.key, name: edit.name, type: edit.type, unit: edit.unit || null, minValue: edit.minValue, maxValue: edit.maxValue, dependsOnAttributeId: edit.dependsOnAttributeId, options };
      if (edit.id) await api.patch(`/admin/attributes/${edit.id}`, body);
      else await api.post('/admin/attributes', body);
      setEdit(null);
      toast('Сохранено');
      void q.refetch();
    } catch (e) { toast(errorMessage(e), 'error'); }
  };
  return (
    <div>
      <PageTitle actions={<Button onClick={() => open()}>Новая характеристика</Button>}>Характеристики</PageTitle>
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : (
        <DataTable rows={q.data} onRowClick={open} columns={[
          { key: 'n', label: 'Название', render: (a) => <span><b>{a.name}</b> <span className="text-xs text-ink-400">{a.key}</span></span> },
          { key: 't', label: 'Тип', render: (a) => TYPE_LABEL[a.type] },
          { key: 'u', label: 'Ед.', render: (a) => a.unit ?? '' },
          { key: 'o', label: 'Значений', render: (a) => a.options.length || '' },
        ]} />
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Характеристика" size="lg" footer={<Button onClick={save}>Сохранить</Button>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ключ (латиница)" htmlFor="ak"><Input id="ak" value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} /></Field>
            <Field label="Название" htmlFor="an"><Input id="an" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Тип" htmlFor="at">
              <Select id="at" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                {ATTRIBUTE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </Select>
            </Field>
            <Field label="Единица" htmlFor="au"><Input id="au" value={edit.unit ?? ''} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} /></Field>
            <Field label="Мин." htmlFor="amin"><Input id="amin" type="number" value={edit.minValue ?? ''} onChange={(e) => setEdit({ ...edit, minValue: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="Макс." htmlFor="amax"><Input id="amax" type="number" value={edit.maxValue ?? ''} onChange={(e) => setEdit({ ...edit, maxValue: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="Зависит от" htmlFor="adep">
              <Select id="adep" value={edit.dependsOnAttributeId ?? ''} onChange={(e) => setEdit({ ...edit, dependsOnAttributeId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {q.data?.filter((a) => a.type === 'enum' && a.id !== edit.id).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.key})</option>)}
              </Select>
            </Field>
            {['enum', 'multi_enum'].includes(edit.type) && (
              <div className="sm:col-span-2">
                <Field label="Значения: по одному в строке «код | подпись | код родителя»" htmlFor="ao">
                  <Textarea id="ao" rows={10} className="font-mono text-sm" value={edit.optionsText} onChange={(e) => setEdit({ ...edit, optionsText: e.target.value })} />
                </Field>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
