import type { Metadata } from 'next';
import type { ListingDetail } from '@lotok/shared';
import { ListingDetailView } from '@/components/listing-detail';
import { serverGet } from '@/lib/api';
import { priceLabel } from '@/lib/format';

type Props = { params: Promise<{ id: string }> };

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const l = isUuid(id) ? await serverGet<ListingDetail>(`/listings/${id}`, 60).catch(() => null) : null;
  if (!l) return { title: 'Объявление' };
  const image = l.photos[0]?.urls.large ?? undefined;
  return {
    title: `${l.title} — ${priceLabel(l)} в г. ${l.cityName ?? ''}`,
    description: l.description.slice(0, 160),
    alternates: { canonical: `/listing/${l.id}` },
    openGraph: { title: l.title, description: l.description.slice(0, 200), images: image ? [image] : [] },
    robots: l.status === 'active' ? undefined : { index: false },
  };
}

export default async function ListingPage({ params }: Props) {
  const { id } = await params;
  const initial = isUuid(id) ? await serverGet<ListingDetail>(`/listings/${id}`, 30).catch(() => null) : null;
  const jsonLd = initial
    ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: initial.title,
        description: initial.description,
        image: initial.photos.map((p) => p.urls.large).filter(Boolean),
        offers: initial.price
          ? { '@type': 'Offer', price: initial.price / 100, priceCurrency: 'RUB', availability: initial.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut' }
          : undefined,
      }
    : null;
  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />}
      <ListingDetailView id={id} initial={initial} />
    </>
  );
}
