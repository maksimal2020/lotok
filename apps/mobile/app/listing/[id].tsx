import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Alert, Dimensions, FlatList, Linking, ScrollView, Text, TextInput, View } from 'react-native';
import { LABELS, type ListingDetail, type OrderDto } from '@lotok/shared';
import { api, errorMessage } from '@/api';
import { useAuth } from '@/auth';
import { Button, C, Card, Empty, Loading, priceLabel, s } from '@/ui';

const W = Dimensions.get('window').width;

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['listing', id, user?.id], queryFn: () => api.get<ListingDetail>(`/listings/${id}`) });
  const [msg, setMsg] = useState('Здравствуйте! Ещё актуально?');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data?.status === 'active') void api.post(`/listings/${id}/view`).catch(() => undefined);
  }, [q.data?.status, id]);
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <Empty title="Объявление не найдено" text={q.error ? errorMessage(q.error) : undefined} />;
  const l = q.data;
  const needAuth = () => router.push('/auth/login');

  const write = async () => {
    if (!user) return needAuth();
    setBusy(true);
    try {
      const r = await api.post<{ conversationId: string }>('/conversations', { listingId: l.id, message: msg.trim() });
      router.push(`/chat/${r.conversationId}`);
    } catch (e) {
      Alert.alert('Ошибка', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const buy = async () => {
    if (!user) return needAuth();
    setBusy(true);
    try {
      // Самовывоз с онлайн-оплатой; оплата — на странице провайдера (в тестовом режиме — тестовая страница).
      const o = await api.request<OrderDto>('POST', '/orders', {
        body: { listingId: l.id, deliveryMethod: 'pickup', payOnline: true },
        headers: { 'Idempotency-Key': `m-${l.id.slice(0, 8)}-${Date.now().toString(36)}` },
      });
      if (o.payment?.confirmationUrl) await WebBrowser.openBrowserAsync(o.payment.confirmationUrl);
      if (o.payment) await api.post(`/payments/${o.payment.id}/sync`).catch(() => undefined);
      router.push('/orders');
    } catch (e) {
      Alert.alert('Не удалось оформить заказ', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.screen}>
      <FlatList
        horizontal
        pagingEnabled
        data={l.photos}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <Image source={{ uri: item.urls.large ?? undefined }} style={{ width: W, height: W * 0.75, backgroundColor: '#000' }} contentFit="contain" accessibilityLabel={l.title} />}
        ListEmptyComponent={<View style={{ width: W, height: W * 0.5, backgroundColor: C.line }} />}
      />
      <View style={{ padding: 12, gap: 12 }}>
        <Card style={{ gap: 6 }}>
          <Text style={{ fontSize: 26, fontWeight: '800' }}>{priceLabel(l)}</Text>
          <Text style={{ fontSize: 18 }}>{l.title}</Text>
          <Text style={{ color: C.muted }}>
            {l.cityName} · {LABELS.listingStatus[l.status]}
          </Text>
        </Card>
        {!l.isOwner && l.status === 'active' && (
          <Card style={{ gap: 10 }}>
            {l.canBuy && <Button variant="accent" title="Купить" loading={busy} onPress={buy} />}
            {l.contactMethods.includes('chat') && (
              <>
                <TextInput accessibilityLabel="Сообщение продавцу" value={msg} onChangeText={setMsg} style={s.input} />
                <Button title="Написать продавцу" loading={busy} onPress={write} />
              </>
            )}
            {l.contactMethods.includes('phone') && (
              <Button
                variant="outline"
                title="Позвонить"
                onPress={async () => {
                  if (!user) return needAuth();
                  try {
                    const r = await api.get<{ phone: string }>(`/listings/${l.id}/phone`);
                    await Linking.openURL(`tel:${r.phone}`);
                  } catch (e) {
                    Alert.alert('Телефон недоступен', errorMessage(e));
                  }
                }}
              />
            )}
            <Button
              variant="outline"
              title={l.isFavorite ? 'В избранном ♥' : 'В избранное'}
              onPress={async () => {
                if (!user) return needAuth();
                if (l.isFavorite) await api.delete(`/favorites/${l.id}`);
                else await api.post(`/favorites/${l.id}`);
                void q.refetch();
              }}
            />
          </Card>
        )}
        {!!l.attributes.length && (
          <Card style={{ gap: 6 }}>
            {l.attributes.map((a) => (
              <View key={a.key} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ color: C.muted }}>{a.name}</Text>
                <Text style={{ flexShrink: 1, textAlign: 'right' }}>{a.display}</Text>
              </View>
            ))}
          </Card>
        )}
        <Card>
          <Text style={{ lineHeight: 22 }}>{l.description || 'Без описания'}</Text>
        </Card>
        <Card>
          <Text style={{ fontWeight: '700' }}>{l.seller.displayName}</Text>
          <Text style={{ color: C.muted }}>{l.seller.ratingAvg ? `★ ${l.seller.ratingAvg.toFixed(1)} · ${l.seller.ratingCount} отзывов` : 'Нет отзывов'}</Text>
        </Card>
      </View>
    </ScrollView>
  );
}
