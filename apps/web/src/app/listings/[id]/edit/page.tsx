'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import type { ListingDetail } from '@lotok/shared';
import { ListingForm } from '@/components/listing-form';
import { EmptyState, ErrorState, PageTitle, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';

export default function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useRequireAuth();
  const q = useQuery({ queryKey: ['listing-edit', id], queryFn: () => api.get<ListingDetail>(`/listings/${id}`), enabled: !!user, gcTime: 0 });
  if (!user || q.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (q.isError) return <div className="container-page py-10"><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>;
  if (!q.data?.isOwner) return <div className="container-page py-10"><EmptyState title="Объявление не найдено" /></div>;
  return (
    <div className="container-page max-w-3xl py-6">
      <PageTitle>Редактирование</PageTitle>
      <ListingForm existing={q.data} />
    </div>
  );
}
