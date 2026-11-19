'use client';

import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useMemo, useState } from 'react';
import type { MapPoint } from '@lotok/shared';
import { Alert, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useCategories, useCities } from '@/lib/hooks';

const ListingsMap = dynamic(() => import('@/components/map-views').then((m) => m.ListingsMap), { ssr: false, loading: () => <div className="skeleton size-full" /> });

function MapScreen() {
  const params = useSearchParams();
  const cities = useCities();
  const cats = useCategories();
  const [bbox, setBbox] = useState<string | null>(null);
  const [cat, setCat] = useState(params.get('categoryId') ?? '');
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const city = cities.data?.find((c) => String(c.id) === params.get('cityId'));
  const center: [number, number] | null = lat && lng ? [lat, lng] : city?.lat && city.lng ? [city.lat, city.lng] : cities.data ? [55.7558, 37.6173] : null;
  const query = useMemo(() => {
    const q: Record<string, string> = {};
    params.forEach((v, k) => {
      if (!['lat', 'lng', 'radiusKm', 'cityId', 'focus', 'page'].includes(k)) q[k] = v;
    });
    if (cat) q.categoryId = cat;
    else delete q.categoryId;
    if (bbox) q.bbox = bbox;
    return q;
  }, [params, bbox, cat]);
  const pts = useQuery({ queryKey: ['map', query], queryFn: () => api.get<MapPoint[]>('/search/map', query), enabled: !!bbox, placeholderData: (p) => p });
  const onBounds = useCallback((b: { south: number; west: number; north: number; east: number }) => setBbox([b.south, b.west, b.north, b.east].map((x) => x.toFixed(4)).join(',')), []);
  return (
    <div className="container-page py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold">Объявления на карте</h1>
        <Select aria-label="Категория" className="w-auto!" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Все категории</option>
          {cats.data?.flatMap((r) => [r, ...(r.children ?? [])]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <span className="text-sm text-ink-500">{pts.data ? `${pts.data.length} на экране` : ''}</span>
      </div>
      {pts.isError && <Alert tone="danger">{errorMessage(pts.error)}</Alert>}
      <div className="h-[calc(100vh-14rem)] min-h-[420px] overflow-hidden rounded-2xl bg-white">
        {center && <ListingsMap points={pts.data ?? []} center={center} zoom={lat ? 13 : 11} onBounds={onBounds} focusId={params.get('focus')} />}
      </div>
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense>
      <MapScreen />
    </Suspense>
  );
}
