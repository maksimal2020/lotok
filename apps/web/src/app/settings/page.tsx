'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NOTIFICATION_CHANNELS, NOTIFICATION_GROUPS, type MediaItem, type Me, type NotificationPreferenceDto } from '@lotok/shared';
import { Alert, Avatar, Button, Card, Field, Input, PageTitle, Select, Spinner, Textarea, Toggle, useConfirm, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { useCities } from '@/lib/hooks';
import { relativeDate } from '@/lib/format';

const GROUP_LABELS: Record<string, string> = {
  messages: 'Сообщения',
  orders: 'Заказы',
  listings: 'Мои объявления',
  saved_searches: 'Сохранённые поиски',
  billing: 'Платежи и услуги',
  marketing: 'Акции и новости',
  security: 'Безопасность',
};
const CHANNEL_LABELS: Record<string, string> = { in_app: 'На сайте', email: 'Email', push: 'Push', sms: 'SMS' };

function ProfileSection({ user, onSaved }: { user: Me; onSaved: (u: Me) => void }) {
  const toast = useToast();
  const cities = useCities();
  const [f, setF] = useState({ displayName: user.displayName, about: user.about ?? '', cityId: user.cityId ?? '', showPhone: user.showPhone });
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">Профиль</h2>
      <div className="mb-4 flex items-center gap-4">
        <Avatar name={user.displayName} url={user.avatarUrl} size={64} />
        <label className="cursor-pointer text-sm font-semibold text-brand-600 hover:underline">
          Изменить фото
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const form = new FormData();
                form.append('file', file);
                let m = await api.upload<MediaItem>('/media?purpose=avatar', form);
                for (let i = 0; i < 30 && m.status !== 'ready' && m.status !== 'failed'; i++) {
                  await new Promise((r) => setTimeout(r, 700));
                  m = await api.get<MediaItem>(`/media/${m.id}`);
                }
                if (m.status !== 'ready') throw new Error('Не удалось обработать изображение');
                onSaved(await api.patch<Me>('/users/me', { avatarMediaId: m.id }));
                toast('Фото обновлено');
              } catch (err) {
                toast(errorMessage(err), 'error');
              }
            }}
          />
        </label>
      </div>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            onSaved(await api.patch<Me>('/users/me', { displayName: f.displayName, about: f.about || null, cityId: f.cityId ? Number(f.cityId) : null, showPhone: f.showPhone }));
            toast('Сохранено');
          } catch (err) {
            toast(errorMessage(err), 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Имя" htmlFor="dn"><Input id="dn" value={f.displayName} maxLength={60} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
          <Field label="Город" htmlFor="ct">
            <Select id="ct" value={f.cityId} onChange={(e) => setF({ ...f, cityId: e.target.value })}>
              <option value="">Не указан</option>
              {cities.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="О себе" htmlFor="ab"><Textarea id="ab" maxLength={1000} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} /></Field>
        <Button type="submit" loading={busy}>Сохранить</Button>
      </form>
    </Card>
  );
}

function ContactsSection({ user, reload }: { user: Me; reload: () => Promise<void> }) {
  const toast = useToast();
  const [phone, setPhone] = useState(user.phone ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">Контакты</h2>
      <div className="mb-4 text-sm">
        Email: <b>{user.email ?? 'не указан'}</b> {user.email && (user.emailVerified ? '✓ подтверждён' : '— не подтверждён')}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (!sent) {
              await api.post('/auth/phone/attach/request', { phone });
              setSent(true);
              toast('Код отправлен по SMS');
            } else {
              await api.post('/auth/phone/attach', { phone, code });
              await reload();
              setSent(false);
              setCode('');
              toast('Телефон подтверждён');
            }
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        }}
      >
        <Field label={`Телефон${user.phoneVerified ? ' ✓' : ''}`} htmlFor="ph">
          <Input id="ph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent} placeholder="+7 900 000-00-00" />
        </Field>
        {sent && <Field label="Код из SMS" htmlFor="cd"><Input id="cd" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>}
        <Button type="submit" variant="outline">{sent ? 'Подтвердить' : user.phoneVerified ? 'Изменить номер' : 'Подтвердить номер'}</Button>
      </form>
    </Card>
  );
}

function PasswordSection() {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">Пароль</h2>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post('/auth/password/change', { currentPassword: cur, newPassword: next });
            setCur('');
            setNext('');
            toast('Пароль изменён. Другие сеансы завершены.');
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        }}
      >
        <Field label="Текущий пароль" htmlFor="cp"><Input id="cp" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="Новый пароль" htmlFor="np"><Input id="np" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Button type="submit" variant="outline">Сменить</Button>
      </form>
    </Card>
  );
}

function SessionsSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const { logout } = useRequireAuth();
  const router = useRouter();
  const q = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<{ id: string; platform: string; deviceName: string | null; userAgent: string | null; ip: string | null; lastUsedAt: string; current: boolean }[]>('/auth/sessions'),
  });
  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">Активные сеансы</h2>
      <ul className="divide-y divide-ink-100">
        {q.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <div className="font-semibold">{s.deviceName ?? { web: 'Браузер', ios: 'iOS', android: 'Android' }[s.platform] ?? s.platform} {s.current && <span className="text-sm text-brand-600">(этот сеанс)</span>}</div>
              <div className="truncate text-sm text-ink-500">{s.userAgent?.slice(0, 80)} · {s.ip} · {relativeDate(s.lastUsedAt)}</div>
            </div>
            {!s.current && (
              <Button size="sm" variant="ghost" onClick={async () => { await api.delete(`/auth/sessions/${s.id}`).catch((e) => toast(errorMessage(e), 'error')); void q.refetch(); }}>
                Завершить
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button
        className="mt-3"
        variant="outline"
        onClick={async () => {
          if (!(await confirm({ title: 'Выйти на всех устройствах?', text: 'Потребуется войти заново везде, включая это устройство.', confirmText: 'Выйти везде', danger: true }))) return;
          await logout(true);
          router.push('/auth/login');
        }}
      >
        Выйти на всех устройствах
      </Button>
    </Card>
  );
}

function NotificationsSection() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['prefs'], queryFn: () => api.get<NotificationPreferenceDto[]>('/users/me/notification-preferences') });
  const [prefs, setPrefs] = useState<NotificationPreferenceDto[]>([]);
  useEffect(() => {
    if (q.data) setPrefs(q.data);
  }, [q.data]);
  const get = (g: string, c: string) => prefs.find((p) => p.group === g && p.channel === c)?.enabled ?? false;
  const channels = NOTIFICATION_CHANNELS.filter((c) => c !== 'sms');
  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">Уведомления</h2>
      {!q.data ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500">
                <th className="py-2 font-semibold">Тема</th>
                {channels.map((c) => <th key={c} className="px-2 py-2 text-center font-semibold">{CHANNEL_LABELS[c]}</th>)}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_GROUPS.map((g) => (
                <tr key={g} className="border-t border-ink-100">
                  <td className="py-2.5">{GROUP_LABELS[g]}</td>
                  {channels.map((c) => (
                    <td key={c} className="px-2 text-center">
                      <Toggle
                        label={`${GROUP_LABELS[g]}: ${CHANNEL_LABELS[c]}`}
                        checked={get(g, c)}
                        onChange={async (v) => {
                          const next = prefs.map((p) => (p.group === g && p.channel === c ? { ...p, enabled: v } : p));
                          setPrefs(next);
                          try {
                            setPrefs(await api.put<NotificationPreferenceDto[]>('/users/me/notification-preferences', { preferences: [{ group: g, channel: c, enabled: v }] }));
                          } catch (e) {
                            toast(errorMessage(e), 'error');
                          }
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-500">Уведомления о безопасности на сайте отключить нельзя.</p>
        </div>
      )}
    </Card>
  );
}

function DangerSection() {
  const confirm = useConfirm();
  const router = useRouter();
  const toast = useToast();
  const { setUser } = useRequireAuth();
  const blocked = useQuery({ queryKey: ['blocked'], queryFn: () => api.get<{ id: string; displayName: string }[]>('/users/me/blocked') });
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">Конфиденциальность</h2>
      <div className="mb-4">
        <div className="mb-1 text-sm font-semibold">Заблокированные пользователи</div>
        {blocked.data?.length ? (
          <ul className="space-y-1">
            {blocked.data.map((b) => (
              <li key={b.id} className="flex items-center justify-between text-sm">
                {b.displayName}
                <Button size="sm" variant="ghost" onClick={async () => { await api.delete(`/users/${b.id}/block`); void blocked.refetch(); }}>Разблокировать</Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-500">Нет</p>}
      </div>
      <div className="mb-4">
        <Button variant="outline" size="sm" onClick={async () => { await api.delete('/recently-viewed'); toast('История просмотров и интересы очищены'); }}>
          Очистить историю просмотров и рекомендации
        </Button>
      </div>
      <Alert tone="danger">
        Удаление аккаунта: объявления будут сняты, персональные данные обезличены. Финансовые записи хранятся в соответствии с законом.
      </Alert>
      <Button
        className="mt-3"
        variant="danger"
        onClick={async () => {
          if (!(await confirm({ title: 'Удалить аккаунт?', text: 'Действие необратимо.', confirmText: 'Удалить навсегда', danger: true }))) return;
          try {
            await api.delete('/users/me');
            setUser(null);
            router.push('/');
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        }}
      >
        Удалить аккаунт
      </Button>
    </Card>
  );
}

export default function SettingsPage() {
  const { user, setUser, reload } = useRequireAuth();
  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  return (
    <div className="container-page max-w-3xl space-y-5 py-6">
      <PageTitle>Настройки</PageTitle>
      <ProfileSection user={user} onSaved={setUser} />
      <ContactsSection user={user} reload={reload} />
      <PasswordSection />
      <NotificationsSection />
      <SessionsSection />
      <DangerSection />
    </div>
  );
}
