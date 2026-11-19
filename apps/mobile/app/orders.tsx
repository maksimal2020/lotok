import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { LABELS, formatMoney, type OrderDto, type Paginated } from '@lotok/shared';
import { api, errorMessage } from '@/api';
import { Button, C, Card, Empty, Loading, s } from '@/ui';

const ACTIONS: Record<string, string> = { confirm: 'Подтвердить', ship: 'Отправлено', deliver: 'Доставлено', complete: 'Получил', cancel: 'Отменить' };

export default function Orders() {
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const q = useQuery({ queryKey: ['m-orders', role], queryFn: () => api.get<Paginated<OrderDto>>('/orders', { role, limit: 50 }) });
  return (
    <View style={s.screen}>
      <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
        {(['buyer', 'seller'] as const).map((r) => (
          <Pressable key={r} accessibilityRole="tab" accessibilityState={{ selected: role === r }} onPress={() => setRole(r)} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: role === r ? C.ink : C.white }}>
            <Text style={{ textAlign: 'center', color: role === r ? C.white : C.ink, fontWeight: '600' }}>{r === 'buyer' ? 'Покупки' : 'Продажи'}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        contentContainerStyle={{ padding: 12, gap: 10 }}
        data={q.data?.items ?? []}
        keyExtractor={(o) => o.id}
        ListEmptyComponent={q.isLoading ? <Loading /> : <Empty title="Заказов нет" />}
        renderItem={({ item: o }) => (
          <Card style={{ gap: 6 }}>
            <Text style={{ fontWeight: '700' }}>№ {o.number} · {o.listing.title}</Text>
            <Text>{formatMoney(o.total)} · {LABELS.orderStatus[o.status]} · {LABELS.orderPaymentStatus[o.paymentStatus]}</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {o.availableActions.filter((a) => ACTIONS[a]).map((a) => (
                <Button
                  key={a}
                  variant={a === 'cancel' ? 'outline' : 'primary'}
                  title={ACTIONS[a]}
                  onPress={async () => {
                    try {
                      await api.post(`/orders/${o.id}/${a}`);
                      void q.refetch();
                    } catch (e) {
                      Alert.alert('Ошибка', errorMessage(e));
                    }
                  }}
                />
              ))}
            </View>
          </Card>
        )}
      />
    </View>
  );
}
