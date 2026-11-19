import { useQuery } from '@tanstack/react-query';
import { FlatList } from 'react-native';
import type { ListingCard, Paginated } from '@lotok/shared';
import { api } from '@/api';
import { Empty, ListingTile, Loading, s } from '@/ui';

export default function Favorites() {
  const q = useQuery({ queryKey: ['m-fav'], queryFn: () => api.get<Paginated<ListingCard>>('/favorites', { limit: 60 }) });
  return (
    <FlatList
      style={s.screen}
      numColumns={2}
      contentContainerStyle={{ padding: 5 }}
      data={q.data?.items ?? []}
      keyExtractor={(l) => l.id}
      ListEmptyComponent={q.isLoading ? <Loading /> : <Empty title="В избранном пусто" />}
      renderItem={({ item }) => <ListingTile l={item} />}
    />
  );
}
