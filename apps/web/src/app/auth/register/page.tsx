'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { registerSchema } from '@lotok/shared';
import { Alert, Button, Checkbox, Field, Input } from '@/components/ui';
import { errorMessage, fieldErrors } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function RegisterForm() {
  const auth = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [terms, setTerms] = useState(false);
  const [pd, setPd] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-2xl bg-white p-6 shadow-[var(--shadow-card)] md:p-8">
        <h1 className="mb-1 text-2xl font-extrabold">Регистрация</h1>
        <p className="mb-5 text-ink-500">
          Уже есть аккаунт?{' '}
          <Link href="/auth/login" className="font-semibold text-brand-600 hover:underline">
            Войти
          </Link>
        </p>
        <form
          className="space-y-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const parsed = registerSchema.safeParse({ ...form, acceptTerms: terms, acceptPersonalData: pd });
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
              return;
            }
            setErrors({});
            setBusy(true);
            try {
              await auth.register(parsed.data as Parameters<typeof auth.register>[0]);
              router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/profile?welcome=1');
            } catch (err) {
              setErrors(fieldErrors(err));
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Имя" htmlFor="name" error={errors.displayName} required>
            <Input id="name" autoComplete="name" value={form.displayName} onChange={set('displayName')} invalid={!!errors.displayName} />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email} required>
            <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} invalid={!!errors.email} />
          </Field>
          <Field label="Пароль" htmlFor="password" error={errors.password} hint="Не менее 8 символов, буквы и цифры" required>
            <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} invalid={!!errors.password} />
          </Field>
          <div>
            <Checkbox checked={terms} onChange={setTerms} label={<>Принимаю <Link href="/help/terms" className="text-brand-600 underline">пользовательское соглашение</Link></>} />
            {errors.acceptTerms && <p className="text-sm text-danger">{errors.acceptTerms}</p>}
            <Checkbox checked={pd} onChange={setPd} label={<>Даю согласие на <Link href="/help/privacy" className="text-brand-600 underline">обработку персональных данных</Link></>} />
            {errors.acceptPersonalData && <p className="text-sm text-danger">{errors.acceptPersonalData}</p>}
          </div>
          <Button type="submit" block size="lg" loading={busy}>
            Зарегистрироваться
          </Button>
          <p className="text-center text-xs text-ink-500">После регистрации мы отправим письмо для подтверждения email.</p>
        </form>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
