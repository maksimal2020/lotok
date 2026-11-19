import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import type { CategoryAttributeDto, CategoryDto, ListingDetail, MediaItem, RegionDto } from '@lotok/shared';
import { api, errorMessage } from '@/api';
import { useAuth } from '@/auth';
import { Button, C, Card, Empty, Field, s } from '@/ui';
import { buildListingPayload } from '@/listing-payload';

function Chips<T extends { id: number; name: string }>({ items, value, onChange }: { items: T[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.map((i) => (
        <Pressable key={i.id} accessibilityRole="button" accessibilityState={{ selected: value === i.id }} onPress={() => onChange(i.id)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: value === i.id ? C.brand : C.bg }}>
          <Text style={{ color: value === i.id ? C.white : C.ink }}>{i.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function Create() {
  const { user } = useAuth();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryDto[]>('/categories') });
  const cities = useQuery({ queryKey: ['cities'], queryFn: () => api.get<RegionDto[]>('/regions/cities', { popular: 1 }) });
  const [path, setPath] = useState<CategoryDto[]>([]);
  const leaf = path.at(-1);
  const isLeaf = !!leaf && !leaf.children?.length;
  const attrs = useQuery({ queryKey: ['attrs', leaf?.id], queryFn: () => api.get<CategoryAttributeDto[]>(`/categories/${leaf!.id}/attributes`), enabled: isLeaf });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [cityId, setCityId] = useState<number | null>(user?.cityId ?? null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <View style={[s.screen, { padding: 16 }]}>
        <Empty title="Войдите, чтобы разместить объявление" />
        <Button title="Войти" onPress={() => router.push('/auth/login')} />
      </View>
    );
  }

  const level = path.length === 0 ? (cats.data ?? []) : (path.at(-1)!.children ?? []);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.85, selectionLimit: 10 });
    if (r.canceled) return;
    for (const a of r.assets) {
      const form = new FormData();
      form.append('file', { uri: a.uri, name: a.fileName ?? 'photo.jpg', type: a.mimeType ?? 'image/jpeg' } as unknown as Blob);
      try {
        let m = await api.upload<MediaItem>('/media?purpose=listing', form);
        for (let i = 0; i < 30 && m.status !== 'ready' && m.status !== 'failed'; i++) {
          await new Promise((res) => setTimeout(res, 700));
          m = await api.get<MediaItem>(`/media/${m.id}`);
        }
        if (m.status === 'ready') setPhotos((p) => [...p, m]);
        else Alert.alert('Фото не обработано', 'Попробуйте другое изображение');
      } catch (e) {
        Alert.alert('Ошибка загрузки', errorMessage(e));
      }
    }
  };

  const submit = async () => {
    if (!leaf || !cityId) return Alert.alert('Заполните категорию и город');
    setBusy(true);
    try {
      const payload = buildListingPayload({ categoryId: leaf.id, title, description, price, cityId, attributes: values, attributeDefs: attrs.data ?? [], mediaIds: photos.map((p) => p.id) });
      const created = await api.post<ListingDetail>('/listings', payload);
      const submitted = await api.post<ListingDetail>(`/listings/${created.id}/submit`);
      Alert.alert(submitted.status === 'active' ? 'Опубликовано' : submitted.status === 'moderation' ? 'Отправлено на проверку' : 'Отклонено автоматической проверкой', submitted.rejectionReason ?? undefined);
      setPath([]);
      setTitle('');
      setDescription('');
      setPrice('');
      setValues({});
      setPhotos([]);
      router.push(`/listing/${created.id}`);
    } catch (e) {
      Alert.alert('Не удалось опубликовать', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 12, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 10 }}>
        <Text style={{ fontWeight: '700' }}>Категория: {path.map((p) => p.name).join(' › ') || 'не выбрана'}</Text>
        {!isLeaf && <Chips items={level} value={null} onChange={(id) => setPath([...path, level.find((c) => c.id === id)!])} />}
        {path.length > 0 && <Button variant="outline" title="Изменить категорию" onPress={() => { setPath([]); setValues({}); }} />}
      </Card>
      {isLeaf && (
        <>
          <Card style={{ gap: 12 }}>
            <Field label="Название" value={title} onChangeText={setTitle} maxLength={120} />
            <Field label="Описание" value={description} onChangeText={setDescription} multiline maxLength={7500} />
            <Field label="Цена, ₽" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
          </Card>
          {!!attrs.data?.length && (
            <Card style={{ gap: 12 }}>
              <Text style={{ fontWeight: '700' }}>Характеристики</Text>
              {attrs.data.map((a) => {
                const opts = a.options.filter((o) => !a.dependsOn || !o.parentValue || o.parentValue === values[a.dependsOn]).slice(0, 40);
                return a.type === 'enum' ? (
                  <View key={a.id} style={{ gap: 6 }}>
                    <Text style={s.label}>{a.name}{a.isRequired ? ' *' : ''}</Text>
                    <Chips items={opts.map((o, i) => ({ id: i, name: o.label }))} value={opts.findIndex((o) => o.value === values[a.key])} onChange={(i) => setValues({ ...values, [a.key]: opts[i].value })} />
                  </View>
                ) : a.type === 'boolean' ? (
                  <Button key={a.id} variant={values[a.key] === 'true' ? 'primary' : 'outline'} title={a.name} onPress={() => setValues({ ...values, [a.key]: values[a.key] === 'true' ? 'false' : 'true' })} />
                ) : (
                  <Field key={a.id} label={`${a.name}${a.unit ? `, ${a.unit}` : ''}${a.isRequired ? ' *' : ''}`} value={values[a.key] ?? ''} keyboardType={a.type === 'string' ? 'default' : 'numeric'} onChangeText={(v) => setValues({ ...values, [a.key]: v })} />
                );
              })}
            </Card>
          )}
          <Card style={{ gap: 10 }}>
            <Text style={{ fontWeight: '700' }}>Фотографии ({photos.length})</Text>
            <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
              {photos.map((p) => (
                <Pressable key={p.id} onLongPress={() => setPhotos(photos.filter((x) => x.id !== p.id))} accessibilityHint="Удерживайте, чтобы удалить">
                  <Image source={{ uri: p.urls.thumb ?? undefined }} style={{ width: 96, height: 72, borderRadius: 10 }} />
                </Pressable>
              ))}
            </ScrollView>
            <Button variant="outline" title="Добавить фото" onPress={pick} />
          </Card>
          <Card style={{ gap: 10 }}>
            <Text style={{ fontWeight: '700' }}>Город</Text>
            <Chips items={cities.data ?? []} value={cityId} onChange={setCityId} />
          </Card>
          <Button variant="accent" title="Опубликовать" loading={busy} onPress={submit} />
        </>
      )}
    </ScrollView>
  );
}
