'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { LinkButton, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function Verify() {
  const token = useSearchParams().get('token');
  const { user, reload } = useAuth();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (!token) {
      setState('error');
      setMsg('Ссылка неполная.');
      return;
    }
    api
      .post('/auth/verify-email', { token })
      .then(() => {
        setState('ok');
        if (user) void reload();
      })
      .catch((e) => {
        setState('error');
        setMsg(errorMessage(e));
      });
  }, [token, user, reload]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      {state === 'loading' && <Spinner className="size-10" />}
      {state === 'ok' && (
        <>
          <CheckCircle2 className="size-14 text-success" />
          <h1 className="text-2xl font-extrabold">Email подтверждён</h1>
          <p className="text-ink-500">Теперь вы можете публиковать объявления и оформлять заказы.</p>
          <LinkButton href="/listings/new">Разместить объявление</LinkButton>
        </>
      )}
      {state === 'error' && (
        <>
          <XCircle className="size-14 text-danger" />
          <h1 className="text-2xl font-extrabold">Не удалось подтвердить</h1>
          <p className="text-ink-500">{msg}</p>
          <LinkButton href="/settings" variant="outline">
            Отправить письмо повторно
          </LinkButton>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
