'use client';

import { useQuery } from '@tanstack/react-query';
import { Globe, MapPin, ShieldCheck } from 'lucide-react';
import { use, useState } from 'react';
import type { OrganizationDto } from '@lotok/shared';
import { Badge, Button, Card, ErrorState, Field, Input, Modal, Spinner, Textarea, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['org', id], queryFn: () => api.get<OrganizationDto>(`/organizations/${id}`) });
  const isMember = !!user?.organizations.some((o) => o.id === id);
  const isOwner = !!user?.organizations.some((o) => o.id === id && o.role === 'owner');
  const members = useQuery({ queryKey: ['org-members', id], queryFn: () => api.get<{ userId: string; displayName: string; email: string | null; role: string }[]>(`/organizations/${id}/members`), enabled: isMember });
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ description: '', website: '' });
  const [invite, setInvite] = useState('');
  if (q.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (q.isError) return <div className="container-page py-10"><ErrorState message={errorMessage(q.error)} /></div>;
  const o = q.data!;
  return (
    <div className="container-page max-w-4xl space-y-5 py-6">
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex size-20 items-center justify-center overflow-hidden rounded-2xl bg-brand-50 text-2xl font-extrabold text-brand-600">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {o.logoUrl ? <img src={o.logoUrl} alt="" className="size-full object-cover" /> : o.name[0]}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="break-anywhere text-2xl font-extrabold">{o.name}</h1>
            <div className="mt-1 flex flex-wrap gap-2">
              {o.verified ? <Badge tone="success"><ShieldCheck className="size-3" /> Проверена</Badge> : <Badge>Не проверена</Badge>}
              <Badge>ИНН {o.inn}</Badge>
              <Badge tone="brand">{o.activeListings} объявлений</Badge>
            </div>
            {o.legalAddress && <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-500"><MapPin className="size-4" /> {o.legalAddress}</p>}
            {o.website && (
              <a href={o.website} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 flex items-center gap-1.5 text-sm text-brand-600">
                <Globe className="size-4" /> {o.website}
              </a>
            )}
          </div>
          {isMember && <Button variant="outline" onClick={() => { setForm({ description: o.description ?? '', website: o.website ?? '' }); setEdit(true); }}>Редактировать</Button>}
        </div>
        {o.description && <p className="mt-4 whitespace-pre-line break-anywhere text-ink-700">{o.description}</p>}
      </Card>
      {isMember && (
        <Card>
          <h2 className="mb-3 font-bold">Сотрудники</h2>
          <ul className="mb-3 space-y-1">
            {members.data?.map((m) => (
              <li key={m.userId} className="flex justify-between text-sm">
                <span>{m.displayName} <span className="text-ink-500">{m.email}</span></span>
                <Badge>{m.role === 'owner' ? 'владелец' : 'менеджер'}</Badge>
              </li>
            ))}
          </ul>
          {isOwner && (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.post(`/organizations/${id}/members`, { email: invite });
                  setInvite('');
                  void members.refetch();
                  toast('Сотрудник добавлен');
                } catch (err) {
                  toast(errorMessage(err), 'error');
                }
              }}
            >
              <Input type="email" placeholder="email сотрудника" aria-label="Email сотрудника" value={invite} onChange={(e) => setInvite(e.target.value)} />
              <Button type="submit">Добавить</Button>
            </form>
          )}
          <p className="mt-3 text-sm text-ink-500">Объявления компании публикуются сотрудниками с выбором организации в форме объявления (через API). Проверку компании проводит модерация по ИНН.</p>
        </Card>
      )}
      <Modal
        open={edit}
        onClose={() => setEdit(false)}
        title="Профиль компании"
        footer={
          <Button
            onClick={async () => {
              try {
                await api.patch(`/organizations/${id}`, { description: form.description || undefined, website: form.website || undefined });
                setEdit(false);
                void q.refetch();
              } catch (e) {
                toast(errorMessage(e), 'error');
              }
            }}
          >
            Сохранить
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Описание" htmlFor="od">
            <Textarea id="od" maxLength={3000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Сайт" htmlFor="ow">
            <Input id="ow" type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
