'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronLeft, ChevronRight, Flag, MapPin, MessageCircle, Pencil, Phone, Rocket, Share2, ShieldCheck, ShoppingCart, Star, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { COMPLAINT_REASONS, LABELS, type ListingDetail } from '@lotok/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { lastSeen, memberSince, priceLabel, relativeDate } from '@/lib/format';
import { FavoriteButton } from './listing-card';
import { Alert, Avatar, Badge, Button, EmptyState, Field, LinkButton, Modal, Select, Skeleton, Textarea, useToast } from './ui';

function Gallery({ l }: { l: ListingDetail }) {
  const [i, setI] = useState(0);
  const photos = l.photos.filter((p) => p.urls.large);
  if (!photos.length) return <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-ink-100 text-ink-400">Нет фото</div>;
  const cur = photos[Math.min(i, photos.length - 1)];
  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-ink-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur.urls.large!} alt={`${l.title} — фото ${i + 1} из ${photos.length}`} className="aspect-[4/3] w-full object-contain" />
        {photos.length > 1 && (
          <>
            <button aria-label="Предыдущее фото" onClick={() => setI((i - 1 + photos.length) % photos.length)} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow">
              <ChevronLeft className="size-5" />
            </button>
            <button aria-label="Следующее фото" onClick={() => setI((i + 1) % photos.length)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow">
              <ChevronRight className="size-5" />
            </button>
            <span className="absolute bottom-3 right-3 rounded-lg bg-ink-900/70 px-2 py-0.5 text-sm text-white">
              {i + 1} / {photos.length}
            </span>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, k) => (
            <button key={p.id} onClick={() => setI(k)} aria-label={`Фото ${k + 1}`} aria-current={k === i} className={`shrink-0 overflow-hidden rounded-lg ring-2 ${k === i ? 'ring-brand-500' : 'ring-transparent'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.urls.thumb!} alt="" className="h-16 w-20 object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactPanel({ l }: { l: ListingDetail }) {
  // Пока сессия восстанавливается, кнопки неактивны — иначе клик до восстановления уводил бы на страницу входа.
  const { user, ready } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [phone, setPhone] = useState<string | null>(null);
  const [msgOpen, setMsgOpen] = useState(false);
  const [text, setText] = useState('Здравствуйте! Объявление ещё актуально?');
  const [sending, setSending] = useState(false);
  const needAuth = () => router.push(`/auth/login?next=${encodeURIComponent(`/listing/${l.id}`)}`);

  if (l.isOwner) {
    return (
      <div className="space-y-2">
        <Alert tone="info">
          Это ваше объявление · <b>{LABELS.listingStatus[l.status]}</b>
          {l.rejectionReason && <div className="mt-1">Причина: {l.rejectionReason}</div>}
        </Alert>
        <LinkButton href={`/listings/${l.id}/edit`} variant="outline" block>
          <Pencil className="size-4" /> Редактировать
        </LinkButton>
        {l.status === 'active' && (
          <LinkButton href={`/promote/${l.id}`} variant="accent" block>
            <Rocket className="size-4" /> Продвинуть
          </LinkButton>
        )}
        <LinkButton href={`/my/listings/${l.id}/stats`} variant="ghost" block>
          <BarChart3 className="size-4" /> Статистика
        </LinkButton>
      </div>
    );
  }
  if (l.status !== 'active') return <Alert tone="warning">Объявление {LABELS.listingStatus[l.status].toLowerCase()}</Alert>;
  return (
    <div className="space-y-2">
      {l.canBuy && (
        <LinkButton href={`/checkout/${l.id}`} variant="accent" size="lg" block>
          <ShoppingCart className="size-5" /> Купить {l.deliveryAvailable ? 'с доставкой' : ''}
        </LinkButton>
      )}
      {l.contactMethods.includes('chat') && (
        <Button size="lg" block disabled={!ready} onClick={() => (user ? setMsgOpen(true) : needAuth())}>
          <MessageCircle className="size-5" /> Написать продавцу
        </Button>
      )}
      {l.contactMethods.includes('phone') && (
        <Button
          size="lg"
          variant="outline"
          block
          disabled={!ready}
          onClick={async () => {
            if (!user) return needAuth();
            try {
              setPhone((await api.get<{ phone: string }>(`/listings/${l.id}/phone`)).phone);
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        >
          <Phone className="size-5" /> {phone ? <a href={`tel:${phone}`}>{phone}</a> : 'Показать телефон'}
        </Button>
      )}
      <Modal
        open={msgOpen}
        onClose={() => setMsgOpen(false)}
        title="Сообщение продавцу"
        footer={
          <Button
            loading={sending}
            disabled={!text.trim()}
            onClick={async () => {
              setSending(true);
              try {
                const r = await api.post<{ conversationId: string }>('/conversations', { listingId: l.id, message: text.trim() });
                router.push(`/messages/${r.conversationId}`);
              } catch (e) {
                toast(errorMessage(e), 'error');
              } finally {
                setSending(false);
              }
            }}
          >
            Отправить
          </Button>
        }
      >
        <Field label="Текст сообщения" htmlFor="first-msg">
          <Textarea id="first-msg" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
        </Field>
        <p className="mt-3 text-xs text-ink-500">Не переходите в сторонние мессенджеры и не сообщайте данные карты — так безопаснее.</p>
      </Modal>
    </div>
  );
}

function ComplaintButton({ targetType, targetId }: { targetType: 'listing' | 'user'; targetId: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>('fraud');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button onClick={() => (user ? setOpen(true) : router.push('/auth/login'))} className="flex items-center gap-1.5 text-sm text-ink-500 hover:text-danger">
        <Flag className="size-4" /> Пожаловаться
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Жалоба"
        footer={
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post('/complaints', { targetType, targetId, reason, comment: comment || undefined });
                toast('Жалоба отправлена. Спасибо!');
                setOpen(false);
              } catch (e) {
                toast(errorMessage(e), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Отправить жалобу
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Причина" htmlFor="c-reason">
            <Select id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {COMPLAINT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {LABELS.complaintReason[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Комментарий" htmlFor="c-comment">
            <Textarea id="c-comment" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function ListingDetailView({ id, initial }: { id: string; initial: ListingDetail | null }) {
  const { user, ready } = useAuth();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['listing', id, user?.id ?? 'anon'],
    queryFn: () => api.get<ListingDetail>(`/listings/${id}`),
    initialData: initial ?? undefined,
    // SSR-данные могут быть закэшированы (ISR) — на клиенте всегда сверяемся с API (статус, избранное, владелец).
    initialDataUpdatedAt: 0,
    enabled: ready,
  });
  useEffect(() => {
    if (ready && q.data?.status === 'active') void api.post(`/listings/${id}/view`).catch(() => undefined);
  }, [ready, id, q.data?.status]);

  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="container-page py-10">
        <EmptyState title={notFound ? 'Объявление не найдено' : 'Не удалось загрузить объявление'} text={notFound ? 'Возможно, оно удалено или снято с публикации.' : errorMessage(q.error)} action={<LinkButton href="/">На главную</LinkButton>} />
      </div>
    );
  }
  const l = q.data;
  if (!l) {
    return (
      <div className="container-page grid gap-6 py-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }
  return (
    <div className="container-page py-5">
      <nav aria-label="Хлебные крошки" className="mb-3 text-sm text-ink-500">
        <ol className="flex flex-wrap gap-1.5">
          {l.category.path.map((p, i) => (
            <li key={p.id} className="flex gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              <Link href={`/c/${p.slug}`} className="hover:text-brand-600">
                {p.name}
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <div>
            <h1 className="break-anywhere text-2xl font-extrabold tracking-tight md:text-3xl">{l.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-500">
              {l.isPremium && <Badge tone="accent">Премиум</Badge>}
              {l.status !== 'active' && <Badge tone="warning">{LABELS.listingStatus[l.status]}</Badge>}
              <span>{relativeDate(l.publishedAt)}</span>
              <span>· {l.viewsCount} просмотров</span>
            </div>
          </div>
          <Gallery l={l} />
          {!!l.attributes.length && (
            <section className="rounded-2xl bg-white p-5">
              <h2 className="mb-3 text-lg font-bold">Характеристики</h2>
              <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {l.condition && (
                  <div className="flex justify-between gap-4 border-b border-dashed border-ink-200 py-1">
                    <dt className="text-ink-500">Состояние</dt>
                    <dd className="text-right font-medium">{LABELS.condition[l.condition]}</dd>
                  </div>
                )}
                {l.attributes.map((a) => (
                  <div key={a.key} className="flex justify-between gap-4 border-b border-dashed border-ink-200 py-1">
                    <dt className="text-ink-500">{a.name}</dt>
                    <dd className="break-anywhere text-right font-medium">{a.display}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <section className="rounded-2xl bg-white p-5">
            <h2 className="mb-3 text-lg font-bold">Описание</h2>
            <p className="whitespace-pre-line break-anywhere leading-relaxed text-ink-700">{l.description || 'Продавец не добавил описание.'}</p>
            {l.videoUrl && (
              <a href={l.videoUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-4 inline-block font-semibold text-brand-600 hover:underline">
                Смотреть видео →
              </a>
            )}
          </section>
          <section className="rounded-2xl bg-white p-5">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
              <MapPin className="size-5 text-brand-500" /> Расположение
            </h2>
            <p className="text-ink-700">
              {l.cityName}
              {l.address ? `, ${l.address}` : ''}
            </p>
            {l.lat && l.lng && (
              <Link href={`/map?lat=${l.lat}&lng=${l.lng}&radiusKm=5&focus=${l.id}`} className="mt-2 inline-block text-sm font-semibold text-brand-600 hover:underline">
                Показать на карте
              </Link>
            )}
          </section>
          <div className="flex flex-wrap items-center gap-4 text-sm text-ink-500">
            <span>Объявление № {l.id.slice(0, 8)}</span>
            {!l.isOwner && <ComplaintButton targetType="listing" targetId={l.id} />}
            <button
              className="flex items-center gap-1.5 hover:text-ink-900"
              onClick={async () => {
                const url = location.href;
                if (navigator.share) await navigator.share({ title: l.title, url }).catch(() => undefined);
                else {
                  await navigator.clipboard.writeText(url);
                  toast('Ссылка скопирована');
                }
              }}
            >
              <Share2 className="size-4" /> Поделиться
            </button>
          </div>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="text-3xl font-extrabold">{priceLabel(l)}</div>
              {!l.isOwner && <FavoriteButton listing={l} className="bg-ink-100" />}
            </div>
            {l.priceType === 'negotiable' && <div className="text-sm text-ink-500">Возможен торг</div>}
            {l.deliveryAvailable && (
              <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-brand-600">
                <Truck className="size-4" /> Есть доставка
              </div>
            )}
            <div className="mt-4">
              <ContactPanel l={l} />
            </div>
          </div>
          <div className="rounded-2xl bg-white p-5">
            <Link href={l.seller.organization ? `/company/${l.seller.organization.id}` : `/u/${l.seller.id}`} className="flex items-center gap-3">
              <Avatar name={l.seller.displayName} url={l.seller.avatarUrl} size={52} />
              <div className="min-w-0">
                <div className="truncate font-bold hover:text-brand-600">{l.seller.organization?.name ?? l.seller.displayName}</div>
                <div className="flex items-center gap-1 text-sm text-ink-500">
                  <Star className="size-4 fill-accent-500 text-accent-500" />
                  {l.seller.ratingAvg ? `${l.seller.ratingAvg.toFixed(1)} · ${l.seller.ratingCount} отзывов` : 'Нет отзывов'}
                </div>
              </div>
            </Link>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {l.seller.isPro && <Badge tone="brand">PRO</Badge>}
              {l.seller.organization?.verified && (
                <Badge tone="success">
                  <ShieldCheck className="size-3" /> Компания проверена
                </Badge>
              )}
            </div>
            <div className="mt-3 text-sm text-ink-500">
              {memberSince(l.seller.createdAt)} · {l.seller.activeListings} объявлений
              {l.seller.lastSeenAt && <div>{lastSeen(l.seller.lastSeenAt)}</div>}
            </div>
          </div>
          <div className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-800">
            <b>Безопасность.</b> Не переводите предоплату незнакомым людям и не сообщайте коды из SMS. Общайтесь во встроенном чате.
          </div>
        </aside>
      </div>
    </div>
  );
}
