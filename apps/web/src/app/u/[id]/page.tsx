import type { Metadata } from 'next';
import type { PublicUser } from '@lotok/shared';
import { SellerProfile } from '@/components/seller-profile';
import { serverGet } from '@/lib/api';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const u = /^[0-9a-f-]{36}$/i.test(id) ? await serverGet<PublicUser>(`/users/${id}`, 300).catch(() => null) : null;
  return { title: u ? `${u.displayName} — объявления продавца` : 'Продавец' };
}

export default async function SellerPage({ params }: Props) {
  return <SellerProfile userId={(await params).id} />;
}
