'use client';

import { useState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-2xl bg-white p-6 shadow-[var(--shadow-card)] md:p-8">
        <h1 className="mb-4 text-2xl font-extrabold">Восстановление доступа</h1>
        {sent ? (
          <Alert tone="success">Если аккаунт с таким email существует, мы отправили на него ссылку для смены пароля. Ссылка действует 1 час.</Alert>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api.post('/auth/password/reset-request', { email });
                setSent(true);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" block loading={busy}>
              Отправить ссылку
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
