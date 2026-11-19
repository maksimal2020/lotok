'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { OrganizationDto } from '@lotok/shared';
import { Alert, Button, Card, Field, Input, PageTitle, Spinner, Textarea } from '@/components/ui';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';

export default function NewCompanyPage() {
  const { user, reload } = useRequireAuth();
  const router = useRouter();
  const [f, setF] = useState({ name: '', inn: '', ogrn: '', legalAddress: '', website: '', description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="container-page max-w-2xl py-6">
      <PageTitle>Профиль компании</PageTitle>
      <Card>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
              const o = await api.post<OrganizationDto>('/organizations', body);
              await reload();
              router.push(`/company/${o.id}`);
            } catch (err) {
              setErrors(fieldErrors(err));
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Название" htmlFor="n" required error={errors.name}><Input id="n" value={f.name} onChange={set('name')} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ИНН" htmlFor="i" required error={errors.inn}><Input id="i" inputMode="numeric" value={f.inn} onChange={set('inn')} /></Field>
            <Field label="ОГРН / ОГРНИП" htmlFor="o" error={errors.ogrn}><Input id="o" inputMode="numeric" value={f.ogrn} onChange={set('ogrn')} /></Field>
          </div>
          <Field label="Юридический адрес" htmlFor="a"><Input id="a" value={f.legalAddress} onChange={set('legalAddress')} /></Field>
          <Field label="Сайт" htmlFor="w" error={errors.website}><Input id="w" type="url" value={f.website} onChange={set('website')} /></Field>
          <Field label="О компании" htmlFor="d"><Textarea id="d" maxLength={3000} value={f.description} onChange={set('description')} /></Field>
          <Button type="submit" loading={busy}>Создать</Button>
          <p className="text-sm text-ink-500">Для отметки «Компания проверена» модерация сверяет реквизиты по данным ФНС.</p>
        </form>
      </Card>
    </div>
  );
}
