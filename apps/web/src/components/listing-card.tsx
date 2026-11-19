'use client';

import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Heart, ImageOff, Sparkles, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ListingCard as Card } from '@lotok/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { priceLabel, relativeDate } from '@/lib/format';
import { Skeleton, useToast } from './ui';

export function FavoriteButton({ listing, className }: { listing: Pick<Card, 'id' | 'isFavorite'>; className?: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [fav, setFav] = useState(listing.isFavorite);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={fav}
      aria-label={fav ? 'Убрать из избранного' : 'Добавить в избранное'}
      disabled={busy}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!user) return router.push('/auth/login?next=' + encodeURIComponent(location.pathname));
        setBusy(true);
        const next = !fav;
        setFav(next);
        try {
          if (next) await api.post(`/favorites/${listing.id}`);
          else await api.delete(`/favorites/${listing.id}`);
          void qc.invalidateQueries({ queryKey: ['favorites'] });
        } catch (err) {
          setFav(!next);
          toast(errorMessage(err), 'error');
        } finally {
          setBusy(false);
        }
      }}
      className={clsx('flex size-9 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition hover:scale-105', className)}
    >
      <Heart className={clsx('size-5', fav ? 'fill-danger text-danger' : 'text-ink-700')} />
    </button>
  );
}

export function ListingCardView({ l, layout = 'grid' }: { l: Card; layout?: 'grid' | 'row' }) {
  const img = l.photo?.thumb;
  return (
    <article className={clsx('group relative overflow-hidden rounded-[var(--radius-card)] bg-white transition-shadow hover:shadow-[var(--shadow-card)]', l.isHighlighted && 'ring-2 ring-accent-300', layout === 'row' && 'flex gap-4 p-3')}>
      <Link href={`/listing/${l.id}`} className={clsx('block', layout === 'row' ? 'flex min-w-0 flex-1 gap-4' : '')}>
        <div className={clsx('relative overflow-hidden bg-ink-100', layout === 'row' ? 'aspect-[4/3] w-36 shrink-0 rounded-xl sm:w-48' : 'aspect-[4/3]')}>
          {img ? (
            // Превью уже сжаты сервером (WebP 400×300); lazy-загрузка вне экрана.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} srcSet={l.photo?.medium ? `${img} 400w, ${l.photo.medium} 960w` : undefined} sizes="(max-width: 640px) 50vw, 300px" alt={l.title} loading="lazy" decoding="async" width={400} height={300} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          ) : (
            <div className="flex size-full items-center justify-center text-ink-300">
              <ImageOff className="size-8" aria-hidden />
            </div>
          )}
          {l.isPremium && (
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded-lg bg-accent-500 px-2 py-0.5 text-xs font-bold text-ink-900">
              <Sparkles className="size-3" /> Премиум
            </span>
          )}
          {l.photosCount > 1 && <span className="absolute bottom-2 right-2 rounded-md bg-ink-900/60 px-1.5 text-xs text-white">{l.photosCount} фото</span>}
        </div>
        <div className={clsx('min-w-0', layout === 'row' ? 'flex-1 py-1' : 'p-3')}>
          <div className="text-[17px] font-extrabold">{priceLabel(l)}</div>
          <h3 className="mt-0.5 line-clamp-2 break-anywhere text-[15px] leading-snug text-ink-900 group-hover:text-brand-600">{l.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-500">
            <span className="truncate">{l.cityName}</span>
            {l.distanceKm !== undefined && l.distanceKm !== null && <span>· {l.distanceKm} км</span>}
            {l.publishedAt && <span>· {relativeDate(l.publishedAt)}</span>}
          </div>
          {l.deliveryAvailable && (
            <div className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
              <Truck className="size-3.5" /> Доставка
            </div>
          )}
        </div>
      </Link>
      <FavoriteButton listing={l} className={layout === 'row' ? 'absolute right-3 top-3' : 'absolute right-2 top-2'} />
    </article>
  );
}

export function ListingGrid({ items, loading, cols = 4 }: { items?: Card[]; loading?: boolean; cols?: 3 | 4 | 5 }) {
  const grid = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' }[cols];
  if (loading) {
    return (
      <div className={clsx('grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4', grid)} aria-busy>
        {Array.from({ length: cols * 2 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[var(--radius-card)] bg-white">
            <Skeleton className="aspect-[4/3] rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={clsx('grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4', grid)}>
      {items?.map((l) => <ListingCardView key={l.id} l={l} />)}
    </div>
  );
}
