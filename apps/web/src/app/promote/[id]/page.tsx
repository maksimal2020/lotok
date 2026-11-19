'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import type { ListingDetail } from '@lotok/shared';
import { ServicesGrid } from '@/components/services';
import { Alert, Card, ErrorState, PageTitle, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { priceLabel } from '@/lib/format';

export default function PromotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useRequireAuth();
  const router = useRouter();
  const q = useQuery({ queryKey: ['listing', id, 'promote'], queryFn: () => api.get<ListingDetail>(`/listings/${id}`), enabled: !!user });
  if (!user || q.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (q.isError) return <div className="container-page py-10"><ErrorState message={errorMessage(q.error)} /></div>;
  const l = q.data!;
  return (
    <div className="container-page max-w-5xl py-6">
      <PageTitle>Продвижение объявления</PageTitle>
      <Card className="mb-5 flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {l.photo?.thumb && <img src={l.photo.thumb} alt="" className="size-16 rounded-xl object-cover" />}
        <div>
          <div className="font-bold">{l.title}</div>
          <div className="text-sm text-ink-500">{priceLabel(l)}</div>
        </div>
      </Card>
      {!l.isOwner || l.status !== 'active' ? (
        <Alert tone="warning">Продвигать можно только своё опубликованное объявление.</Alert>
      ) : (
        <>
          {!!l.promotions.length && (
            <div className="mb-4">
              <Alert tone="success">Активно: {l.promotions.map((p) => `${{ bump: 'поднятие', highlight: 'выделение', premium: 'премиум' }[p.type]} до ${new Date(p.endsAt).toLocaleDateString('ru-RU')}`).join(', ')}</Alert>
            </div>
          )}
          <ServicesGrid types={['bump', 'highlight', 'premium']} listingId={id} onDone={() => router.push(`/listing/${id}`)} />
          <p className="mt-6 text-sm text-ink-500">
            «Премиум» показывается в отдельном помеченном блоке над результатами поиска и не меняет порядок обычной выдачи. «Поднятие» обновляет дату объявления при сортировке по дате.
          </p>
        </>
      )}
    </div>
  );
}
