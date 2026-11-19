import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { CategoryDto, ListingCard } from '@lotok/shared';
import { api, errorMessage } from '@/api';
import { useAuth } from '@/auth';
import { C, Empty, ListingTile, Loading, s } from '@/ui';

export default function Home() {
  const { user } = useAuth();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryDto[]>('/categories') });
  const rec = useQuery({
    queryKey: ['recommendations', user?.id ?? 'anon'],
    queryFn: () => api.get<{ items: ListingCard[]; strategy: string }>('/recommendations', user?.cityId ? { cityId: user.cityId } : undefined),
  });
  const tiles = (cats.data ?? []).flatMap((r) => (r.slug === 'goods' ? (r.children ?? []).slice(0, 6) : [r]));
  return (
    <FlatList
      style={s.screen}
      data={rec.data?.items ?? []}
      keyExtractor={(i) => i.id}
      numColumns={2}
      contentContainerStyle={{ padding: 5 }}
      refreshControl={<RefreshControl refreshing={rec.isRefetching} onRefresh={() => rec.refetch()} />}
      ListHeaderComponent={
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 5 }}>
            {tiles.map((c) => (
              <Pressable key={c.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/search', params: { categoryId: String(c.id), title: c.name } })} style={{ backgroundColor: C.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }}>
                <Text style={{ fontWeight: '700', color: C.brandDark }}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={[s.h1, { fontSize: 20, margin: 8 }]}>{rec.data?.strategy === 'interests' ? 'Рекомендации для вас' : 'Популярное'}</Text>
          {rec.isLoading && <Loading />}
          {rec.isError && <Empty title="Не удалось загрузить" text={errorMessage(rec.error)} />}
        </View>
      }
      ListEmptyComponent={rec.data ? <Empty title="Пока нет объявлений" /> : null}
      renderItem={({ item }) => <ListingTile l={item} />}
    />
  );
}
