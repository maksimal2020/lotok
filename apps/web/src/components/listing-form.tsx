'use client';

import clsx from 'clsx';
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, LABELS, type CategoryAttributeDto, type CategoryDto, type ListingDetail, type MediaItem } from '@lotok/shared';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { findPath, useAttributes, useCategories, useCities } from '@/lib/hooks';
import { Alert, Button, Checkbox, Field, Input, Select, Textarea, useToast } from './ui';

const MapPicker = dynamic(() => import('./map-views').then((m) => m.MapPicker), { ssr: false, loading: () => <div className="skeleton size-full" /> });

type AttrValue = string | number | boolean | string[];

interface FormState {
  categoryId: number | null;
  title: string;
  description: string;
  price: string;
  priceType: 'fixed' | 'negotiable' | 'free' | 'on_request';
  condition: '' | 'new' | 'used';
  cityId: number | null;
  address: string;
  lat: number | null;
  lng: number | null;
  chat: boolean;
  phone: boolean;
  deliveryAvailable: boolean;
  quantity: string;
  videoUrl: string;
  attributes: Record<string, AttrValue>;
  photos: MediaItem[];
}

function fromListing(l: ListingDetail): FormState {
  return {
    categoryId: l.categoryId,
    title: l.title,
    description: l.description,
    price: l.price !== null ? String(l.price / 100) : '',
    priceType: l.priceType,
    condition: l.condition ?? '',
    cityId: l.cityId,
    address: l.address ?? '',
    lat: l.lat,
    lng: l.lng,
    chat: l.contactMethods.includes('chat'),
    phone: l.contactMethods.includes('phone'),
    deliveryAvailable: l.deliveryAvailable,
    quantity: String(l.quantity),
    videoUrl: l.videoUrl ?? '',
    attributes: Object.fromEntries(l.attributes.map((a) => [a.key, a.value])),
    photos: l.photos,
  };
}

const EMPTY: FormState = {
  categoryId: null,
  title: '',
  description: '',
  price: '',
  priceType: 'fixed',
  condition: '',
  cityId: null,
  address: '',
  lat: null,
  lng: null,
  chat: true,
  phone: false,
  deliveryAvailable: false,
  quantity: '1',
  videoUrl: '',
  attributes: {},
  photos: [],
};

function CategoryPicker({ tree, value, onChange, locked }: { tree: CategoryDto[]; value: number | null; onChange: (id: number) => void; locked?: boolean }) {
  const path = value ? findPath(tree, value) : [];
  const levels: CategoryDto[][] = [tree];
  path.forEach((p) => p.children?.length && levels.push(p.children));
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {levels.map((options, i) => (
        <Select key={i} aria-label={`Категория, уровень ${i + 1}`} disabled={locked} value={path[i]?.id ?? ''} onChange={(e) => onChange(Number(e.target.value))}>
          <option value="" disabled>
            {i === 0 ? 'Раздел' : 'Подкатегория'}
          </option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      ))}
    </div>
  );
}

function AttributeInput({ a, value, onChange, all, error }: { a: CategoryAttributeDto; value: AttrValue | undefined; onChange: (v: AttrValue | undefined) => void; all: Record<string, AttrValue>; error?: string }) {
  const id = `attr-${a.key}`;
  const label = `${a.name}${a.unit ? `, ${a.unit}` : ''}`;
  if (a.type === 'boolean') return <Checkbox id={id} label={a.name} checked={value === true} onChange={(v) => onChange(v)} />;
  let control;
  if (a.type === 'enum') {
    const parent = a.dependsOn ? all[a.dependsOn] : undefined;
    const options = a.dependsOn ? a.options.filter((o) => !o.parentValue || o.parentValue === parent) : a.options;
    control = (
      <Select id={id} value={(value as string) ?? ''} invalid={!!error} disabled={!!a.dependsOn && !parent} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{a.dependsOn && !parent ? 'Сначала выберите родительское значение' : 'Не выбрано'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  } else if (a.type === 'multi_enum') {
    const set = new Set((value as string[]) ?? []);
    control = (
      <div className="flex flex-wrap gap-x-4">
        {a.options.map((o) => (
          <Checkbox key={o.value} label={o.label} checked={set.has(o.value)} onChange={(v) => { const n = new Set(set); if (v) n.add(o.value); else n.delete(o.value); onChange([...n]); }} />
        ))}
      </div>
    );
  } else if (a.type === 'string') {
    control = <Input id={id} value={(value as string) ?? ''} maxLength={500} invalid={!!error} onChange={(e) => onChange(e.target.value || undefined)} />;
  } else {
    control = (
      <Input
        id={id}
        type="number"
        inputMode={a.type === 'decimal' ? 'decimal' : 'numeric'}
        step={a.type === 'decimal' ? 'any' : 1}
        min={a.minValue ?? undefined}
        max={a.maxValue ?? undefined}
        invalid={!!error}
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }
  return (
    <Field label={label} htmlFor={id} required={a.isRequired} error={error}>
      {control}
    </Field>
  );
}

function PhotoManager({ photos, onChange, max }: { photos: MediaItem[]; onChange: (p: MediaItem[] | ((p: MediaItem[]) => MediaItem[])) => void; max: number }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);

  const poll = async (m: MediaItem) => {
    for (let i = 0; i < 40 && (m.status === 'pending' || m.status === 'processing'); i++) {
      await new Promise((r) => setTimeout(r, 800));
      m = await api.get<MediaItem>(`/media/${m.id}`);
    }
    onChange((list) => list.map((x) => (x.id === m.id ? m : x)));
    if (m.status === 'failed') toast('Не удалось обработать фото — загрузите другое', 'error');
  };

  const upload = async (files: FileList | File[]) => {
    const arr = Array.from(files).slice(0, Math.max(0, max - photos.length));
    if (files.length > arr.length) toast(`Можно загрузить не больше ${max} фото`, 'error');
    for (const f of arr) {
      if (f.size > 15 * 1024 * 1024) {
        toast(`«${f.name}» больше 15 МБ`, 'error');
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.append('file', f);
        const m = await api.upload<MediaItem>('/media?purpose=listing', form);
        onChange((list) => [...list, m]);
        void poll(m);
      } catch (e) {
        toast(errorMessage(e), 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= photos.length) return;
    const next = [...photos];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };

  return (
    <div>
      <div
        className="grid grid-cols-3 gap-2 sm:grid-cols-5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
      >
        {photos.map((p, i) => (
          <div
            key={p.id}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              if (drag !== null && !e.dataTransfer.files.length) {
                e.stopPropagation();
                move(drag, i);
                setDrag(null);
              }
            }}
            className={clsx('group relative aspect-[4/3] overflow-hidden rounded-xl bg-ink-100', i === 0 && 'ring-2 ring-brand-500')}
          >
            {p.urls.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.urls.thumb} alt={`Фото ${i + 1}`} className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center text-xs text-ink-500">
                {p.status === 'failed' ? 'Ошибка обработки' : <Loader2 className="size-5 animate-spin" />}
              </div>
            )}
            {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-md bg-brand-500 px-1.5 text-[11px] font-bold text-white">Главное</span>}
            <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
              <div className="flex gap-1">
                <button type="button" aria-label="Переместить влево" onClick={() => move(i, i - 1)} className="rounded-md bg-white/90 p-1">
                  <ArrowLeft className="size-3.5" />
                </button>
                <button type="button" aria-label="Переместить вправо" onClick={() => move(i, i + 1)} className="rounded-md bg-white/90 p-1">
                  <ArrowRight className="size-3.5" />
                </button>
              </div>
              <button type="button" aria-label="Удалить фото" onClick={() => onChange(photos.filter((x) => x.id !== p.id))} className="rounded-md bg-white/90 p-1 text-danger">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        {photos.length < max && (
          <button type="button" onClick={() => input.current?.click()} className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink-300 text-sm font-semibold text-ink-500 hover:border-brand-400 hover:text-brand-600">
            {uploading ? <Loader2 className="size-6 animate-spin" /> : <ImagePlus className="size-6" />}
            Добавить фото
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
      <p className="mt-2 text-sm text-ink-500">До {max} фото, JPEG/PNG/WebP до 15 МБ. Перетащите, чтобы изменить порядок; первое фото — главное.</p>
    </div>
  );
}

export function ListingForm({ existing }: { existing?: ListingDetail }) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const cats = useCategories();
  const cities = useCities();
  const [s, setS] = useState<FormState>(existing ? fromListing(existing) : { ...EMPTY, cityId: user?.cityId ?? null });
  const [version, setVersion] = useState(existing?.version ?? 1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const [listingId, setListingId] = useState(existing?.id ?? null);
  const attrs = useAttributes(s.categoryId);
  const path = s.categoryId && cats.data ? findPath(cats.data, s.categoryId) : [];
  const leaf = path[path.length - 1];
  const isLeaf = !!leaf && !leaf.children?.length;
  const city = cities.data?.find((c) => c.id === s.cityId);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!existing && user?.cityId && !s.cityId) set('cityId', user.cityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.cityId]);

  const payload = useMemo(() => {
    const priceNeeded = s.priceType === 'fixed' || s.priceType === 'negotiable';
    const cleanAttrs: Record<string, AttrValue> = {};
    for (const a of attrs.data ?? []) {
      const v = s.attributes[a.key];
      if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) cleanAttrs[a.key] = v;
    }
    return {
      categoryId: s.categoryId!,
      title: s.title.trim(),
      description: s.description.trim(),
      price: priceNeeded && s.price ? Math.round(Number(s.price.replace(',', '.')) * 100) : null,
      priceType: s.priceType,
      condition: s.condition || null,
      cityId: s.cityId!,
      address: s.address.trim() || null,
      lat: s.lat ?? city?.lat ?? null,
      lng: s.lng ?? city?.lng ?? null,
      contactMethods: [s.chat && 'chat', s.phone && 'phone'].filter(Boolean) as ('chat' | 'phone')[],
      deliveryAvailable: s.deliveryAvailable,
      quantity: Number(s.quantity) || 1,
      videoUrl: s.videoUrl.trim() || null,
      attributes: cleanAttrs,
      mediaIds: s.photos.filter((p) => p.status !== 'failed').map((p) => p.id),
    };
  }, [s, attrs.data, city]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!isLeaf) e.categoryId = 'Выберите категорию до конца';
    if (payload.title.length < 3) e.title = 'Минимум 3 символа';
    if (!s.cityId) e.cityId = 'Укажите город';
    if ((s.priceType === 'fixed' || s.priceType === 'negotiable') && !payload.price) e.price = 'Укажите цену';
    if (!payload.contactMethods.length) e.contacts = 'Выберите хотя бы один способ связи';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = async (mode: 'draft' | 'publish') => {
    setError(null);
    if (!validate()) return;
    setBusy(mode);
    try {
      let id = listingId;
      let current: ListingDetail;
      if (!id) {
        current = await api.post<ListingDetail>('/listings', payload);
        id = current.id;
        setListingId(id);
      } else {
        current = await api.patch<ListingDetail>(`/listings/${id}`, { ...payload, version });
      }
      setVersion(current.version);
      if (mode === 'publish' && ['draft', 'rejected', 'inactive', 'expired', 'archived', 'sold'].includes(current.status)) {
        current = await api.post<ListingDetail>(`/listings/${id}/${current.status === 'draft' || current.status === 'rejected' ? 'submit' : 'republish'}`);
      }
      toast(
        current.status === 'active' ? 'Объявление опубликовано' : current.status === 'moderation' ? 'Объявление отправлено на проверку' : current.status === 'rejected' ? 'Объявление отклонено автоматической проверкой' : 'Черновик сохранён',
        current.status === 'rejected' ? 'error' : 'success',
      );
      router.push(current.status === 'draft' ? '/my/listings?status=draft' : `/listing/${id}`);
    } catch (e) {
      setErrors(fieldErrors(e));
      setError({ text: errorMessage(e), code: e instanceof ApiError ? e.code : undefined });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(null);
    }
  };

  const vertical = leaf?.vertical;
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); void save('publish'); }} noValidate>
      {error && (
        <Alert tone="danger">
          {error.text}
          {error.code === 'listing_limit_exceeded' && (
            <>
              {' '}
              <Link href="/payments/services" className="font-bold underline">
                Купить размещение
              </Link>
            </>
          )}
          {error.code === 'contact_not_verified' && (
            <>
              {' '}
              <Link href="/settings" className="font-bold underline">
                Подтвердить контакты
              </Link>
            </>
          )}
          {error.code === 'version_conflict' && (
            <>
              {' '}
              <button type="button" className="font-bold underline" onClick={() => location.reload()}>
                Обновить
              </button>
            </>
          )}
        </Alert>
      )}
      <section className="rounded-2xl bg-white p-5 md:p-6">
        <h2 className="mb-4 text-lg font-bold">Категория</h2>
        {cats.data ? <CategoryPicker tree={cats.data} value={s.categoryId} onChange={(id) => setS((p) => ({ ...p, categoryId: id, attributes: {} }))} locked={!!existing && existing.status !== 'draft'} /> : <div className="skeleton h-11" />}
        {errors.categoryId && <p className="mt-2 text-sm text-danger">{errors.categoryId}</p>}
      </section>

      {isLeaf && (
        <>
          <section className="space-y-4 rounded-2xl bg-white p-5 md:p-6">
            <h2 className="text-lg font-bold">Основное</h2>
            <Field label="Название" htmlFor="title" required error={errors.title} hint={`${s.title.length}/120 · без контактов и ссылок`}>
              <Input id="title" maxLength={120} value={s.title} invalid={!!errors.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Описание" htmlFor="description" error={errors.description} hint={`${s.description.length}/7500`}>
              <Textarea id="description" rows={6} maxLength={7500} value={s.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            {(vertical === 'goods' || vertical === 'auto') && (
              <Field label="Состояние" htmlFor="condition">
                <Select id="condition" value={s.condition} onChange={(e) => set('condition', e.target.value as FormState['condition'])}>
                  <option value="">Не указано</option>
                  <option value="new">{LABELS.condition.new}</option>
                  <option value="used">{LABELS.condition.used}</option>
                </Select>
              </Field>
            )}
          </section>

          {!!attrs.data?.length && (
            <section className="rounded-2xl bg-white p-5 md:p-6">
              <h2 className="mb-4 text-lg font-bold">Характеристики</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {attrs.data.map((a) => (
                  <AttributeInput
                    key={a.id}
                    a={a}
                    all={s.attributes}
                    value={s.attributes[a.key]}
                    error={errors[`attributes.${a.key}`]}
                    onChange={(v) =>
                      setS((p) => {
                        const next = { ...p.attributes };
                        if (v === undefined) delete next[a.key];
                        else next[a.key] = v;
                        // Сброс зависимых значений (модель при смене марки).
                        for (const d of attrs.data ?? []) if (d.dependsOn === a.key) delete next[d.key];
                        return { ...p, attributes: next };
                      })
                    }
                  />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-4 rounded-2xl bg-white p-5 md:p-6">
            <h2 className="text-lg font-bold">Фотографии</h2>
            <PhotoManager photos={s.photos} onChange={(p) => setS((prev) => ({ ...prev, photos: typeof p === 'function' ? p(prev.photos) : p }))} max={leaf?.maxPhotos ?? 20} />
            {leaf?.allowVideo && (
              <Field label="Ссылка на видео" htmlFor="video" hint="RuTube, VK Видео или YouTube" error={errors.videoUrl}>
                <Input id="video" type="url" placeholder="https://rutube.ru/video/…" value={s.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} />
              </Field>
            )}
          </section>

          <section className="space-y-4 rounded-2xl bg-white p-5 md:p-6">
            <h2 className="text-lg font-bold">Цена</h2>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Тип цены">
              {(['fixed', 'negotiable', 'free', 'on_request'] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={s.priceType === t} onClick={() => set('priceType', t)} className={clsx('h-10 rounded-xl px-4 text-sm font-semibold', s.priceType === t ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-700')}>
                  {{ fixed: 'Фиксированная', negotiable: 'Возможен торг', free: 'Отдам даром', on_request: 'По запросу' }[t]}
                </button>
              ))}
            </div>
            {(s.priceType === 'fixed' || s.priceType === 'negotiable') && (
              <Field label={vertical === 'jobs' ? 'Зарплата, ₽' : 'Цена, ₽'} htmlFor="price" required error={errors.price}>
                <Input id="price" inputMode="decimal" className="max-w-xs" value={s.price} invalid={!!errors.price} onChange={(e) => set('price', e.target.value.replace(/[^\d.,]/g, ''))} />
              </Field>
            )}
            {vertical === 'goods' && (
              <Field label="Количество" htmlFor="qty">
                <Input id="qty" type="number" min={1} max={10000} className="max-w-[140px]" value={s.quantity} onChange={(e) => set('quantity', e.target.value)} />
              </Field>
            )}
          </section>

          <section className="space-y-4 rounded-2xl bg-white p-5 md:p-6">
            <h2 className="text-lg font-bold">Место сделки</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Город" htmlFor="city" required error={errors.cityId}>
                <Select id="city" value={s.cityId ?? ''} invalid={!!errors.cityId} onChange={(e) => setS((p) => ({ ...p, cityId: Number(e.target.value), lat: null, lng: null }))}>
                  <option value="" disabled>
                    Выберите город
                  </option>
                  {cities.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Адрес или метро" htmlFor="address" hint="Не указывайте номер квартиры">
                <Input id="address" maxLength={300} value={s.address} onChange={(e) => set('address', e.target.value)} />
              </Field>
            </div>
            {city?.lat && city.lng && (
              <div>
                <div className="mb-1.5 text-sm font-semibold text-ink-700">Точка на карте (необязательно) — нажмите на карту</div>
                <div className="h-64 overflow-hidden rounded-xl">
                  <MapPicker value={s.lat && s.lng ? [s.lat, s.lng] : null} center={[city.lat, city.lng]} onChange={(lat, lng) => setS((p) => ({ ...p, lat, lng }))} />
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2 rounded-2xl bg-white p-5 md:p-6">
            <h2 className="mb-2 text-lg font-bold">Способ связи</h2>
            <Checkbox label="Сообщения в чате" description="Рекомендуем: номер телефона остаётся скрытым" checked={s.chat} onChange={(v) => set('chat', v)} />
            <Checkbox label="Звонки" description={user?.phoneVerified ? `Покажем номер ${user.phone}` : 'Нужен подтверждённый номер в настройках'} checked={s.phone} onChange={(v) => set('phone', v)} />
            {errors.contacts && <p className="text-sm text-danger">{errors.contacts}</p>}
            {leaf?.allowDelivery && vertical === 'goods' && <Checkbox label="Готов отправить покупателю (доставка с онлайн-оплатой)" checked={s.deliveryAvailable} onChange={(v) => set('deliveryAvailable', v)} />}
          </section>

          <div className="sticky bottom-16 z-10 flex flex-wrap gap-3 rounded-2xl bg-white p-4 shadow-[var(--shadow-pop)] md:bottom-4">
            <Button type="submit" size="lg" loading={busy === 'publish'} disabled={!!busy}>
              {existing?.status === 'active' ? 'Сохранить изменения' : 'Опубликовать'}
            </Button>
            {(!existing || existing.status === 'draft') && (
              <Button type="button" variant="outline" size="lg" loading={busy === 'draft'} disabled={!!busy} onClick={() => void save('draft')}>
                Сохранить черновик
              </Button>
            )}
            <p className="w-full text-xs text-ink-500">Публикуя объявление, вы подтверждаете соответствие <Link href="/help/rules" className="underline">правилам размещения</Link>.</p>
          </div>
        </>
      )}
    </form>
  );
}
