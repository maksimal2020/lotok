import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { LABELS, type ListingCard } from '@lotok/shared';
import { api, errorMessage } from '@/api';
import { Button, C, Card, Empty, Loading, priceLabel, s } from '@/ui';

export default function MyListings() {
  const q = useQuery({ queryKey: ['m-my'], queryFn: () => api.get<{ items: (ListingCard & { viewsCount: number })[] }>('/listings/mine', { limit: 50 }) });
  const act = async (id: string, action: string) => {
    try {
      await api.post(`/listings/${id}/${action}`);
      void q.refetch();
    } catch (e) {
      Alert.alert('Ошибка', errorMessage(e));
    }
  };
  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={{ padding: 12, gap: 10 }}
      data={q.data?.items ?? []}
      keyExtractor={(l) => l.id}
      ListEmptyComponent={q.isLoading ? <Loading /> : <Empty title="Объявлений пока нет" />}
      renderItem={({ item: l }) => (
        <Card style={{ gap: 6 }}>
          <Pressable onPress={() => router.push(`/listing/${l.id}`)}>
            <Text style={{ fontWeight: '700' }}>{l.title}</Text>
            <Text>{priceLabel(l)} · {LABELS.listingStatus[l.status]} · 👁 {l.viewsCount}</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {l.status === 'active' && <Button variant="outline" title="Снять" onPress={() => act(l.id, 'unpublish')} />}
            {l.status === 'active' && <Button variant="outline" title="Продано" onPress={() => act(l.id, 'sold')} />}
            {['inactive', 'expired', 'sold'].includes(l.status) && <Button title="Опубликовать снова" onPress={() => act(l.id, 'republish')} />}
            {(l.status === 'draft' || l.status === 'rejected') && <Button title="На проверку" onPress={() => act(l.id, 'submit')} />}
          </View>
          {l.status === 'rejected' && <Text style={{ color: C.danger }}>Отклонено — исправьте в веб-версии или создайте заново</Text>}
        </Card>
      )}
    />
  );
}
