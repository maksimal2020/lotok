'use client';

import clsx from 'clsx';
import {
  BarChart3,
  Building2,
  ClipboardList,
  Flag,
  FolderTree,
  Gauge,
  History,
  LayoutList,
  ListChecks,
  LogOut,
  Map,
  Megaphone,
  Package,
  CreditCard,
  Settings,
  ShieldAlert,
  Tag,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LABELS, type Permission } from '@lotok/shared';
import { useAdmin } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { LogoMark } from './logo';
import { Alert, Button, Field, Input, Spinner } from './ui';

const NAV: { href: string; label: string; icon: typeof Gauge; perm: Permission }[] = [
  { href: '/', label: 'Обзор', icon: Gauge, perm: 'dashboard.read' },
  { href: '/moderation', label: 'Модерация', icon: ListChecks, perm: 'listings.moderate' },
  { href: '/complaints', label: 'Жалобы', icon: Flag, perm: 'complaints.read' },
  { href: '/listings', label: 'Объявления', icon: LayoutList, perm: 'listings.read' },
  { href: '/users', label: 'Пользователи', icon: Users, perm: 'users.read' },
  { href: '/organizations', label: 'Компании', icon: Building2, perm: 'organizations.read' },
  { href: '/orders', label: 'Заказы', icon: Package, perm: 'orders.read' },
  { href: '/payments', label: 'Платежи', icon: CreditCard, perm: 'payments.read' },
  { href: '/services', label: 'Тарифы и услуги', icon: Tag, perm: 'tariffs.manage' },
  { href: '/categories', label: 'Категории', icon: FolderTree, perm: 'categories.manage' },
  { href: '/attributes', label: 'Характеристики', icon: ClipboardList, perm: 'categories.manage' },
  { href: '/regions', label: 'Регионы', icon: Map, perm: 'regions.manage' },
  { href: '/ads', label: 'Реклама', icon: Megaphone, perm: 'ads.manage' },
  { href: '/analytics', label: 'Аналитика', icon: BarChart3, perm: 'analytics.read' },
  { href: '/audit', label: 'Журнал действий', icon: History, perm: 'audit.read' },
  { href: '/security', label: 'Безопасность', icon: ShieldAlert, perm: 'audit.read' },
  { href: '/settings', label: 'Настройки', icon: Settings, perm: 'settings.manage' },
];

function Login() {
  const { login } = useAdmin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await login(email, password);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-center gap-2">
          <LogoMark />
          <span className="text-lg font-extrabold">Лоток · Администрирование</span>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" htmlFor="e"><Input id="e" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Пароль" htmlFor="p"><Input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button type="submit" block loading={busy}>Войти</Button>
        <p className="text-xs text-ink-500">Доступ только для сотрудников. Все действия записываются в журнал.</p>
      </form>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, ready, can, logout } = useAdmin();
  const pathname = usePathname();
  const router = useRouter();
  const nav = NAV.filter((n) => can(n.perm));
  useEffect(() => {
    const item = NAV.find((n) => n.href !== '/' && pathname.startsWith(n.href));
    if (user && item && !can(item.perm)) router.replace('/');
  }, [user, pathname, can, router]);
  if (!ready) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (!user) return <Login />;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-ink-900 text-ink-200 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <LogoMark size={28} />
          <span className="font-extrabold text-white">Лоток Admin</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Разделы">
          {nav.map((n) => {
            const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', active ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white')}>
                <n.icon className="size-4.5" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-4 text-sm">
          <div className="truncate font-semibold text-white">{user.displayName}</div>
          <div className="truncate text-xs">{user.roles.map((r) => LABELS.role[r]).join(', ')}</div>
          <button onClick={() => void logout()} className="mt-2 flex items-center gap-2 text-xs hover:text-white">
            <LogOut className="size-3.5" /> Выйти
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="flex gap-2 overflow-x-auto bg-ink-900 p-2 md:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-white/80">
              {n.label}
            </Link>
          ))}
        </div>
        <main className="p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

export function DataTable<T>({ rows, columns, empty = 'Нет данных', onRowClick }: { rows: T[] | undefined; columns: { key: string; label: string; render: (r: T) => ReactNode; className?: string }[]; empty?: string; onRowClick?: (r: T) => void }) {
  if (!rows) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!rows.length) return <div className="rounded-2xl bg-white p-10 text-center text-ink-500">{empty}</div>;
  return (
    <div className="overflow-x-auto rounded-2xl bg-white">
      <table className="w-full text-sm">
        <thead className="bg-ink-50 text-left text-ink-500">
          <tr>{columns.map((c) => <th key={c.key} className={clsx('px-4 py-3 font-semibold', c.className)}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={() => onRowClick?.(r)} className={clsx('border-t border-ink-100', onRowClick && 'cursor-pointer hover:bg-ink-50')}>
              {columns.map((c) => <td key={c.key} className={clsx('px-4 py-3 align-top', c.className)}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
