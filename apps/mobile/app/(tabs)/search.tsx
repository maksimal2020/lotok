import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import type { SearchResult } from '@lotok/shared';
import { api, errorMessage } from '@/api';
import { C, Empty, ListingTile, Loading, s } from '@/ui';

const SORTS = [
  ['relevance', 'По умолчанию'],
  ['date_desc', 'Новые'],
  ['price_asc', 'Дешевле'],
  ['price_desc', 'Дороже'],
] as const;

export default function Search() {
  const params = useLocalSearchParams<{ categoryId?: string; title?: string }>();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<string>('relevance');
  const [priceMax, setPriceMax] = useState('');
  const query = { q: q || undefined, categoryId: params.categoryId, sort, priceMax: priceMax ? Math.round(Number(priceMax) * 100) : undefined, limit: 30 };
  const res = useInfiniteQuery({
    queryKey: ['m-search', query],
    queryFn: ({ pageParam }) => api.get<SearchResult>('/search', { ...query, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });
  const items = res.data?.pages.flatMap((p) => p.items) ?? [];
  const premium = res.data?.pages[0]?.premium ?? [];
  return (
    <View style={s.screen}>
      <View style={{ padding: 10, gap: 8, backgroundColor: C.white }}>
        <TextInput
          accessibilityLabel="Поиск по объявлениям"
          placeholder={params.title ? `Поиск в «${params.title}»` : 'Поиск по объявлениям'}
          placeholderTextColor={C.muted}
          value={input}
          onChangeText={setInput}
          returnKeyType="search"
          onSubmitEditing={() => setQ(input.trim())}
          style={[s.input, { borderColor: C.brand, borderWidth: 2 }]}
        />
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {SORTS.map(([v, l]) => (
            <Pressable key={v} onPress={() => setSort(v)} accessibilityRole="button" accessibilityState={{ selected: sort === v }} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: sort === v ? C.ink : C.bg }}>
              <Text style={{ color: sort === v ? C.white : C.ink, fontWeight: '600' }}>{l}</Text>
            </Pressable>
          ))}
          <TextInput accessibilityLabel="Цена до, рублей" keyboardType="numeric" placeholder="Цена до, ₽" value={priceMax} onChangeText={setPriceMax} style={[s.input, { height: 36, width: 110, fontSize: 14 }]} />
        </View>
        {res.data && <Text style={{ color: C.muted }}>Найдено: {res.data.pages[0].total}</Text>}
      </View>
      <FlatList
        data={items}
        numColumns={2}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 5 }}
        onEndReached={() => res.hasNextPage && res.fetchNextPage()}
        ListHeaderComponent={
          premium.length ? (
            <View style={{ backgroundColor: '#FFF6E5', borderRadius: 14, padding: 6, margin: 5 }}>
              <Text style={{ fontWeight: '800', color: '#B45F09', margin: 4 }}>ПРЕМИУМ · платное размещение</Text>
              <View style={{ flexDirection: 'row' }}>{premium.slice(0, 2).map((p) => <ListingTile key={p.id} l={p} />)}</View>
            </View>
          ) : null
        }
        ListEmptyComponent={res.isLoading ? <Loading /> : res.isError ? <Empty title="Ошибка" text={errorMessage(res.error)} /> : <Empty title="Ничего не нашлось" text="Попробуйте изменить запрос" />}
        ListFooterComponent={res.isFetchingNextPage ? <Loading /> : null}
        renderItem={({ item }) => <ListingTile l={item} />}
      />
    </View>
  );
}
