'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Heart, LayoutGrid, MessageCircle, Package, Settings, Star, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { ListingStatus } from '@lotok/shared';
import { ReviewsList } from '@/components/seller-profile';
import { Alert, Avatar, Badge, Button, Card, Spinner, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { memberSince, rub } from '@/lib/format';

function Profile() {
  const { user } = useRequireAuth();
  const welcome = useSearchParams().get('welcome');
  const toast = useToast();
  const [sent, setSent] = useState(false);
  const stats = useQuery({ queryKey: ['my-counts'], queryFn: () => api.get<{ counts: Partial<Record<ListingStatus, number>> }>('/listings/mine', { limit: 1 }), enabled: !!user });
  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  const links = [
    { href: '/my/listings', label: 'Мои объявления', icon: LayoutGrid, value: stats.data?.counts.active ?? 0 },
    { href: '/messages', label: 'Сообщения', icon: MessageCircle },
    { href: '/favorites', label: 'Избранное', icon: Heart },
    { href: '/orders', label: 'Заказы', icon: Package },
    { href: '/payments', label: 'Платежи и услуги', icon: Wallet },
    { href: user.organizations[0] ? `/company/${user.organizations[0].id}` : '/company/new', label: user.organizations[0] ? user.organizations[0].name : 'Профиль компании', icon: Building2 },
    { href: '/settings', label: 'Настройки', icon: Settings },
  ];
  return (
    <div className="container-page max-w-4xl space-y-5 py-6">
      {welcome && <Alert tone="success">Добро пожаловать на Лоток! Мы отправили письмо для подтверждения email.</Alert>}
      {!user.emailVerified && user.email && (
        <Alert tone="warning">
          Email {user.email} не подтверждён.{' '}
          <button
            className="font-bold underline"
            disabled={sent}
            onClick={async () => {
              try {
                await api.post('/auth/resend-verification', { email: user.email });
                setSent(true);
                toast('Письмо отправлено');
              } catch (e) {
                toast(errorMessage(e), 'error');
              }
            }}
          >
            {sent ? 'Письмо отправлено' : 'Отправить письмо ещё раз'}
          </button>
        </Alert>
      )}
      <Card className="flex flex-wrap items-center gap-4">
        <Avatar name={user.displayName} url={user.avatarUrl} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="break-anywhere text-2xl font-extrabold">{user.displayName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
            <Star className="size-4 fill-accent-500 text-accent-500" /> {user.ratingAvg ? `${user.ratingAvg.toFixed(1)} · ${user.ratingCount} отзывов` : 'Отзывов пока нет'}
            {user.proUntil && <Badge tone="brand">PRO</Badge>}
          </div>
          <div className="text-sm text-ink-500">{memberSince(user.createdAt)} · бонусы: {rub(user.bonusBalance)}</div>
        </div>
        <Link href={`/u/${user.id}`}>
          <Button variant="outline">Как меня видят другие</Button>
        </Link>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-2xl bg-white p-4 hover:shadow-[var(--shadow-card)]">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <l.icon className="size-5" />
            </span>
            <span className="flex-1 truncate font-semibold">{l.label}</span>
            {l.value !== undefined && <span className="text-ink-500">{l.value}</span>}
          </Link>
        ))}
      </div>
      <section>
        <h2 className="mb-3 text-xl font-bold">Отзывы обо мне</h2>
        <ReviewsList userId={user.id} />
      </section>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <Profile />
    </Suspense>
  );
}
