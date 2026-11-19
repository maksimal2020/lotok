'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, Heart, Home, LayoutGrid, LogOut, MessageCircle, Package, Plus, Settings, Shield, User, Wallet } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSocket } from '@/lib/socket';
import { Logo } from './logo';
import { SearchBar } from './search-bar';
import { Avatar } from './ui';

function useCounters(enabled: boolean) {
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => api.get<{ messages: number }>('/conversations/unread'), enabled, refetchInterval: 60_000 });
  const notes = useQuery({ queryKey: ['notes-unread'], queryFn: () => api.get<{ count: number }>('/notifications/unread-count'), enabled, refetchInterval: 60_000 });
  const s = useSocket();
  useEffect(() => {
    if (!enabled || !s) return;
    const refresh = () => {
      void unread.refetch();
      void notes.refetch();
    };
    s.on('message:new', refresh);
    s.on('conversation:read', refresh);
    s.on('notification:new', refresh);
    return () => {
      s.off('message:new', refresh);
      s.off('conversation:read', refresh);
      s.off('notification:new', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, s]);
  return { messages: unread.data?.messages ?? 0, notifications: notes.data?.count ?? 0 };
}

function CounterDot({ n }: { n: number }) {
  if (!n) return null;
  return <span className="absolute -right-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{n > 99 ? '99+' : n}</span>;
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!user) return null;
  const isStaff = user.roles.length > 0;
  const items = [
    { href: '/profile', label: 'Профиль', icon: User },
    { href: '/my/listings', label: 'Мои объявления', icon: LayoutGrid },
    { href: '/orders', label: 'Заказы', icon: Package },
    { href: '/payments', label: 'Платежи и услуги', icon: Wallet },
    { href: '/settings', label: 'Настройки', icon: Settings },
  ];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" className="flex items-center gap-2 rounded-xl p-1 hover:bg-ink-100" aria-label="Меню профиля">
        <Avatar name={user.displayName} url={user.avatarUrl} size={34} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-2xl border border-ink-100 bg-white py-2 shadow-[var(--shadow-pop)]">
          <div className="border-b border-ink-100 px-4 pb-3 pt-1">
            <div className="truncate font-bold">{user.displayName}</div>
            <div className="truncate text-sm text-ink-500">{user.email ?? user.phone}</div>
          </div>
          {items.map((i) => (
            <Link key={i.href} href={i.href} role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-ink-50">
              <i.icon className="size-4.5 text-ink-500" /> {i.label}
            </Link>
          ))}
          {isStaff && (
            <a href={process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3001'} role="menuitem" className="flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-ink-50">
              <Shield className="size-4.5 text-ink-500" /> Администрирование
            </a>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-danger hover:bg-ink-50"
          >
            <LogOut className="size-4.5" /> Выйти
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { user, ready } = useAuth();
  const c = useCounters(!!user);
  return (
    <header className="sticky top-0 z-30 border-b border-ink-100 bg-white/95 backdrop-blur">
      <div className="container-page flex h-16 items-center gap-3 md:gap-5">
        <Link href="/" aria-label="Лоток — на главную" className="shrink-0">
          <Logo />
        </Link>
        <Link href="/catalog" className="hidden h-11 items-center gap-2 rounded-xl bg-brand-50 px-4 font-semibold text-brand-700 hover:bg-brand-100 lg:flex">
          <LayoutGrid className="size-4.5" /> Все категории
        </Link>
        <div className="hidden flex-1 md:flex">
          <Suspense>
            <SearchBar />
          </Suspense>
        </div>
        <nav className="ml-auto flex items-center gap-1" aria-label="Основная навигация">
          <Link href="/favorites" className="relative hidden rounded-xl p-2.5 text-ink-700 hover:bg-ink-100 md:block" aria-label="Избранное">
            <Heart className="size-5.5" />
          </Link>
          {user && (
            <>
              <Link href="/messages" className="relative hidden rounded-xl p-2.5 text-ink-700 hover:bg-ink-100 md:block" aria-label={`Сообщения${c.messages ? `, непрочитанных: ${c.messages}` : ''}`}>
                <MessageCircle className="size-5.5" />
                <CounterDot n={c.messages} />
              </Link>
              <Link href="/notifications" className="relative rounded-xl p-2.5 text-ink-700 hover:bg-ink-100" aria-label={`Уведомления${c.notifications ? `, новых: ${c.notifications}` : ''}`}>
                <Bell className="size-5.5" />
                <CounterDot n={c.notifications} />
              </Link>
            </>
          )}
          {ready && !user && (
            <Link href="/auth/login" className="rounded-xl px-3 py-2 font-semibold text-ink-700 hover:bg-ink-100">
              Войти
            </Link>
          )}
          <UserMenu />
          <Link href="/listings/new" className="ml-1 hidden h-11 items-center gap-1.5 rounded-xl bg-accent-500 px-4 font-bold text-ink-900 hover:bg-accent-600 md:flex">
            <Plus className="size-5" /> Разместить объявление
          </Link>
        </nav>
      </div>
      <div className="container-page pb-3 md:hidden">
        <Suspense>
          <SearchBar />
        </Suspense>
      </div>
    </header>
  );
}

/** Нижняя навигация на мобильных устройствах. */
export function MobileTabBar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const c = useCounters(!!user);
  const tabs = [
    { href: '/', label: 'Главная', icon: Home },
    { href: '/favorites', label: 'Избранное', icon: Heart },
    { href: '/listings/new', label: 'Разместить', icon: Plus, accent: true },
    { href: '/messages', label: 'Сообщения', icon: MessageCircle, count: c.messages },
    { href: user ? '/profile' : '/auth/login', label: 'Профиль', icon: User },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-100 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Мобильная навигация">
      <ul className="grid grid-cols-5">
        {tabs.map((t) => {
          const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
          return (
            <li key={t.label}>
              <Link href={t.href} className={clsx('relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', active ? 'text-brand-600' : 'text-ink-500')}>
                <span className={clsx('relative', t.accent && 'rounded-full bg-accent-500 p-1 text-ink-900')}>
                  <t.icon className="size-5.5" />
                  {t.count ? <CounterDot n={t.count} /> : null}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-ink-100 bg-white pb-24 pt-10 md:pb-10">
      <div className="container-page grid gap-8 text-sm text-ink-500 md:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p>Площадка частных объявлений: покупайте, продавайте, ищите работу и услуги рядом с домом.</p>
        </div>
        <div className="space-y-2">
          <div className="font-bold text-ink-900">Покупателям</div>
          <Link className="block hover:text-ink-900" href="/catalog">
            Каталог
          </Link>
          <Link className="block hover:text-ink-900" href="/map">
            Объявления на карте
          </Link>
          <Link className="block hover:text-ink-900" href="/help/safe-deals">
            Как не попасться мошенникам
          </Link>
        </div>
        <div className="space-y-2">
          <div className="font-bold text-ink-900">Продавцам</div>
          <Link className="block hover:text-ink-900" href="/listings/new">
            Разместить объявление
          </Link>
          <Link className="block hover:text-ink-900" href="/help/promotion">
            Продвижение и тарифы
          </Link>
          <Link className="block hover:text-ink-900" href="/company/new">
            Аккаунт для компании
          </Link>
        </div>
        <div className="space-y-2">
          <div className="font-bold text-ink-900">Лоток</div>
          <Link className="block hover:text-ink-900" href="/help">
            Справочный центр
          </Link>
          <Link className="block hover:text-ink-900" href="/help/rules">
            Правила размещения
          </Link>
          <Link className="block hover:text-ink-900" href="/help/privacy">
            Политика обработки персональных данных
          </Link>
          <Link className="block hover:text-ink-900" href="/help/terms">
            Пользовательское соглашение
          </Link>
        </div>
      </div>
      <div className="container-page mt-8 text-xs text-ink-400">© {new Date().getFullYear()} Лоток. Оплата в тестовом режиме: реальные списания не производятся.</div>
    </footer>
  );
}
