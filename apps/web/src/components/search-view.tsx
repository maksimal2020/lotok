'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellPlus, LayoutGrid, List, Map as MapIcon, SlidersHorizontal, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { CategoryAttributeDto, CategoryDto, SearchResult } from '@lotok/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAttributes, useCategories, useCities, findPath } from '@/lib/hooks';
import { count } from '@/lib/format';
import { ListingCardView, ListingGrid } from './listing-card';
import { Button, Checkbox, EmptyState, ErrorState, Input, Modal, Pagination, Select, useToast } from './ui';

const SORTS = [
  ['relevance', 'По умолчанию'],
  ['date_desc', 'По дате'],
  ['price_asc', 'Дешевле'],
  ['price_desc', 'Дороже'],
  ['distance', 'Ближе ко мне'],
] as const;

function useParamState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = (patch: Record<string, string | null>, resetPage = true) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    if (resetPage) sp.delete('page');
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  };
  return { params, set };
}

function AttributeFilter({ a, params, set }: { a: CategoryAttributeDto; params: URLSearchParams; set: (p: Record<string, string | null>) => void }) {
  const key = `attr.${a.key}`;
  if (a.type === 'enum' || a.type === 'multi_enum') {
    const selected = new Set((params.get(key) ?? '').split(',').filter(Boolean));
    const parent = a.dependsOn ? params.get(`attr.${a.dependsOn}`)?.split(',') : null;
    const options = parent ? a.options.filter((o) => !o.parentValue || parent.includes(o.parentValue)) : a.options;
    if (a.dependsOn && !parent) return null;
    const scroll = options.length > 8;
    return (
      <fieldset>
        <legend className="mb-1.5 text-sm font-bold">{a.name}</legend>
        <div className={clsx('space-y-0.5', scroll && 'max-h-56 overflow-y-auto pr-1')}>
          {options.map((o) => (
            <Checkbox
              key={o.value}
              label={o.label}
              checked={selected.has(o.value)}
              onChange={(v) => {
                const next = new Set(selected);
                if (v) next.add(o.value);
                else next.delete(o.value);
                set({ [key]: [...next].join(',') || null });
              }}
            />
          ))}
        </div>
      </fieldset>
    );
  }
  if (a.type === 'boolean') {
    return <Checkbox label={a.name} checked={params.get(key) === 'true'} onChange={(v) => set({ [key]: v ? 'true' : null })} />;
  }
  if (a.type === 'integer' || a.type === 'decimal' || a.type === 'year') {
    return (
      <fieldset>
        <legend className="mb-1.5 text-sm font-bold">
          {a.name}
          {a.unit ? `, ${a.unit}` : ''}
        </legend>
        <div className="flex gap-2">
          <Input type="number" inputMode="decimal" placeholder="от" aria-label={`${a.name} от`} defaultValue={params.get(`${key}.min`) ?? ''} onBlur={(e) => set({ [`${key}.min`]: e.target.value || null })} />
          <Input type="number" inputMode="decimal" placeholder="до" aria-label={`${a.name} до`} defaultValue={params.get(`${key}.max`) ?? ''} onBlur={(e) => set({ [`${key}.max`]: e.target.value || null })} />
        </div>
      </fieldset>
    );
  }
  return null;
}

function Filters({ categoryId, lockedCategory }: { categoryId: number | null; lockedCategory?: CategoryDto | null }) {
  const { params, set } = useParamState();
  const cats = useCategories();
  const cities = useCities();
  const attrs = useAttributes(categoryId);
  const path = categoryId ? findPath(cats.data, categoryId) : [];
  const current = path[path.length - 1];
  const children = current ? (current.children ?? []) : (cats.data ?? []);
  const rub = (v: string | null) => (v ? String(Number(v) / 100) : '');
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-sm font-bold">Категория</div>
        {path.length > 0 && !lockedCategory && (
          <button className="mb-1 text-sm text-brand-600 hover:underline" onClick={() => set({ categoryId: path.length > 1 ? String(path[path.length - 2].id) : null })}>
            ← {path.length > 1 ? path[path.length - 2].name : 'Все категории'}
          </button>
        )}
        {current && <div className="mb-1 font-semibold">{current.name}</div>}
        <ul className="space-y-1">
          {children.map((c) => (
            <li key={c.id}>
              {lockedCategory ? (
                <Link href={`/c/${c.slug}?${params.toString()}`} className="text-[15px] text-ink-700 hover:text-brand-600">
                  {c.name}
                </Link>
              ) : (
                <button className="text-left text-[15px] text-ink-700 hover:text-brand-600" onClick={() => set({ categoryId: String(c.id) })}>
                  {c.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <label htmlFor="f-city" className="mb-1.5 block text-sm font-bold">
          Город
        </label>
        <Select id="f-city" value={params.get('cityId') ?? ''} onChange={(e) => set({ cityId: e.target.value || null })}>
          <option value="">Вся Россия</option>
          {cities.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {params.get('cityId') && (
          <Select aria-label="Радиус поиска" className="mt-2" value={params.get('radiusKm') ?? ''} onChange={(e) => {
            const city = cities.data?.find((c) => String(c.id) === params.get('cityId'));
            if (!e.target.value || !city?.lat) set({ radiusKm: null, lat: null, lng: null });
            else set({ radiusKm: e.target.value, lat: String(city.lat), lng: String(city.lng) });
          }}>
            <option value="">Только в городе</option>
            {[5, 10, 25, 50, 100].map((r) => (
              <option key={r} value={r}>
                + {r} км
              </option>
            ))}
          </Select>
        )}
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-bold">Цена, ₽</legend>
        <div className="flex gap-2">
          <Input type="number" inputMode="numeric" min={0} placeholder="от" aria-label="Цена от" defaultValue={rub(params.get('priceMin'))} onBlur={(e) => set({ priceMin: e.target.value ? String(Math.round(Number(e.target.value) * 100)) : null })} />
          <Input type="number" inputMode="numeric" min={0} placeholder="до" aria-label="Цена до" defaultValue={rub(params.get('priceMax'))} onBlur={(e) => set({ priceMax: e.target.value ? String(Math.round(Number(e.target.value) * 100)) : null })} />
        </div>
      </fieldset>
      {(!current || current.vertical === 'goods' || current.vertical === 'auto') && (
        <fieldset className="space-y-0.5">
          <legend className="mb-1.5 text-sm font-bold">Состояние и доставка</legend>
          <Checkbox label="Новое" checked={params.get('condition') === 'new'} onChange={(v) => set({ condition: v ? 'new' : null })} />
          <Checkbox label="Б/у" checked={params.get('condition') === 'used'} onChange={(v) => set({ condition: v ? 'used' : null })} />
          <Checkbox label="С доставкой" checked={params.get('delivery') === 'true'} onChange={(v) => set({ delivery: v ? 'true' : null })} />
        </fieldset>
      )}
      <Checkbox label="Только с фото" checked={params.get('withPhoto') === 'true'} onChange={(v) => set({ withPhoto: v ? 'true' : null })} />
      {attrs.data?.filter((a) => a.isFilterable).map((a) => <AttributeFilter key={a.id} a={a} params={params} set={set} />)}
      <Button variant="outline" block onClick={() => {
        const keep: Record<string, string | null> = {};
        for (const k of params.keys()) if (k !== 'q' && !(lockedCategory && k === 'categoryId')) keep[k] = null;
        set(keep);
      }}>
        Сбросить фильтры
      </Button>
    </div>
  );
}

export function SearchView({ initial, category, title }: { initial: SearchResult | null; category?: CategoryDto | null; title: string }) {
  const { params, set } = useParamState();
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [view, setView] = useState<'grid' | 'row'>('grid');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = useMemo(() => {
    const q: Record<string, string> = {};
    params.forEach((v, k) => (q[k] = v));
    if (category) q.categoryId = String(category.id);
    return q;
  }, [params, category]);
  const categoryId = query.categoryId ? Number(query.categoryId) : null;
  const res = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<SearchResult>('/search', query),
    initialData: initial ?? undefined,
    placeholderData: (prev) => prev,
  });
  const page = Number(params.get('page') ?? 1);

  const saveSearch = async () => {
    if (!user) return router.push('/auth/login?next=' + encodeURIComponent(location.pathname + location.search));
    const attrs: Record<string, string> = {};
    const rest: Record<string, string | number | boolean> = {};
    Object.entries(query).forEach(([k, v]) => {
      if (k === 'page') return;
      if (k.startsWith('attr.')) attrs[k.slice(5)] = v;
      else rest[k] = ['categoryId', 'cityId', 'priceMin', 'priceMax', 'lat', 'lng', 'radiusKm'].includes(k) ? Number(v) : v === 'true' ? true : v;
    });
    try {
      await api.post('/saved-searches', { name: params.get('q') || title, query: { ...rest, attrs }, notify: true });
      toast('Поиск сохранён — пришлём уведомление о новых объявлениях');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <div className="container-page py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>
          {res.data && <p className="mt-1 text-ink-500">{count(res.data.total, 'объявление', 'объявления', 'объявлений')}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal className="size-4" /> Фильтры
          </Button>
          <Select aria-label="Сортировка" className="h-9 w-auto! text-sm" value={params.get('sort') ?? 'relevance'} onChange={(e) => set({ sort: e.target.value === 'relevance' ? null : e.target.value })}>
            {SORTS.filter(([v]) => v !== 'distance' || params.get('lat')).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <div className="flex rounded-xl bg-white p-0.5">
            <button aria-label="Плиткой" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={clsx('rounded-lg p-2', view === 'grid' && 'bg-ink-100')}>
              <LayoutGrid className="size-4" />
            </button>
            <button aria-label="Списком" aria-pressed={view === 'row'} onClick={() => setView('row')} className={clsx('rounded-lg p-2', view === 'row' && 'bg-ink-100')}>
              <List className="size-4" />
            </button>
          </div>
          <Link href={`/map?${new URLSearchParams(query).toString()}`} className="flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-semibold hover:bg-ink-100">
            <MapIcon className="size-4" /> На карте
          </Link>
          <Button variant="secondary" size="sm" onClick={saveSearch}>
            <BellPlus className="size-4" /> Сохранить поиск
          </Button>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="hidden rounded-2xl bg-white p-5 lg:block" aria-label="Фильтры">
          <Filters categoryId={categoryId} lockedCategory={category} />
        </aside>
        <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Фильтры" footer={<Button onClick={() => setFiltersOpen(false)}>Показать результаты</Button>}>
          <Filters categoryId={categoryId} lockedCategory={category} />
        </Modal>
        <div className="min-w-0">
          {res.isError ? (
            <ErrorState message={errorMessage(res.error)} onRetry={() => res.refetch()} />
          ) : (
            <>
              {!!res.data?.premium.length && (
                <section aria-label="Премиум-объявления" className="mb-5 rounded-2xl bg-accent-50 p-3">
                  <div className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-accent-700">
                    <Sparkles className="size-3.5" /> Премиум · платное размещение
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {res.data.premium.map((l) => (
                      <ListingCardView key={l.id} l={l} />
                    ))}
                  </div>
                </section>
              )}
              {res.data && !res.data.items.length ? (
                <EmptyState title="Ничего не нашлось" text="Попробуйте изменить запрос или ослабить фильтры. Можно сохранить поиск — мы сообщим, когда появятся подходящие объявления." action={<Button variant="secondary" onClick={saveSearch}>Сохранить поиск</Button>} />
              ) : view === 'grid' ? (
                <div className={clsx(res.isFetching && 'opacity-60 transition-opacity')}>
                  <ListingGrid items={res.data?.items} loading={!res.data} cols={3} />
                </div>
              ) : (
                <div className={clsx('space-y-3', res.isFetching && 'opacity-60')}>
                  {res.data?.items.map((l) => <ListingCardView key={l.id} l={l} layout="row" />)}
                </div>
              )}
              {res.data && <Pagination page={page} total={Math.min(res.data.total, 3000)} limit={res.data.limit} onChange={(p) => set({ page: String(p) }, false)} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
