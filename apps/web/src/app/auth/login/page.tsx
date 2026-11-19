'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { AuthResponse } from '@lotok/shared';
import { Alert, Button, Checkbox, Field, Input, Tabs } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [needTerms, setNeedTerms] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-2xl bg-white p-6 shadow-[var(--shadow-card)] md:p-8">
        <h1 className="mb-1 text-2xl font-extrabold">Вход</h1>
        <p className="mb-5 text-ink-500">
          Нет аккаунта?{' '}
          <Link href={`/auth/register?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-600 hover:underline">
            Зарегистрироваться
          </Link>
        </p>
        <Tabs value={mode} onChange={(v) => { setMode(v); setError(null); }} items={[{ value: 'email', label: 'По email' }, { value: 'phone', label: 'По телефону' }]} />
        <div className="mt-5">{error && <Alert tone="danger">{error}</Alert>}</div>
        {mode === 'email' ? (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await auth.login(email, password);
                router.replace(next);
              });
            }}
          >
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Пароль" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" block size="lg" loading={busy}>
              Войти
            </Button>
            <Link href="/auth/forgot" className="block text-center text-sm font-semibold text-brand-600 hover:underline">
              Забыли пароль?
            </Link>
          </form>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (!codeSent) {
                  await api.post('/auth/phone/request', { phone });
                  setCodeSent(true);
                  return;
                }
                try {
                  const r = await api.post<AuthResponse>('/auth/phone/verify', { phone, code, acceptTerms: needTerms ? terms : undefined, platform: 'web' });
                  auth.applyAuth(r);
                  router.replace(next);
                } catch (err) {
                  if ((err as { code?: string }).code === 'terms_required') {
                    setNeedTerms(true);
                    throw new Error('Вы регистрируетесь впервые — примите условия, чтобы продолжить.');
                  }
                  throw err;
                }
              }).catch(() => undefined);
            }}
          >
            <Field label="Номер телефона" htmlFor="phone" hint="Пришлём SMS с кодом">
              <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 900 000-00-00" required value={phone} onChange={(e) => setPhone(e.target.value)} disabled={codeSent} />
            </Field>
            {codeSent && (
              <Field label="Код из SMS" htmlFor="code">
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
            )}
            {needTerms && (
              <Checkbox
                checked={terms}
                onChange={setTerms}
                label={
                  <>
                    Принимаю <Link href="/help/terms" className="text-brand-600 underline">условия использования</Link> и даю согласие на{' '}
                    <Link href="/help/privacy" className="text-brand-600 underline">обработку персональных данных</Link>
                  </>
                }
              />
            )}
            <Button type="submit" block size="lg" loading={busy}>
              {codeSent ? 'Войти' : 'Получить код'}
            </Button>
            {codeSent && (
              <button type="button" className="block w-full text-center text-sm text-ink-500 hover:text-ink-900" onClick={() => { setCodeSent(false); setCode(''); }}>
                Изменить номер или отправить код повторно
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
