'use client';

import { ListingForm } from '@/components/listing-form';
import { Alert, PageTitle, Spinner } from '@/components/ui';
import { useRequireAuth } from '@/lib/auth';
import Link from 'next/link';

export default function NewListingPage() {
  const { user } = useRequireAuth();
  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  return (
    <div className="container-page max-w-3xl py-6">
      <PageTitle>Новое объявление</PageTitle>
      {!user.emailVerified && !user.phoneVerified && (
        <div className="mb-4">
          <Alert tone="warning">
            Для публикации подтвердите email или телефон. Черновик можно сохранить уже сейчас. <Link href="/settings" className="font-bold underline">Перейти в настройки</Link>
          </Alert>
        </div>
      )}
      <ListingForm />
    </div>
  );
}
