'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, Field, Input, LinkButton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-2xl bg-white p-6 shadow-[var(--shadow-card)] md:p-8">
        <h1 className="mb-4 text-2xl font-extrabold">Новый пароль</h1>
        {done ? (
          <div className="space-y-4">
            <Alert tone="success">Пароль изменён. Все сессии завершены — войдите с новым паролем.</Alert>
            <LinkButton href="/auth/login" block>
              Войти
            </LinkButton>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (password !== repeat) return setError('Пароли не совпадают');
              setBusy(true);
              setError(null);
              try {
                await api.post('/auth/password/reset', { token, password });
                setDone(true);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Новый пароль" htmlFor="p1" hint="Не менее 8 символов, буквы и цифры">
              <Input id="p1" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Повторите пароль" htmlFor="p2">
              <Input id="p2" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </Field>
            <Button type="submit" block loading={busy}>
              Сохранить
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
