import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { ConversationDto, CursorPage } from '@lotok/shared';
import { api, errorMessage } from '@/api';
import { useAuth } from '@/auth';
import { useSocket } from '@/socket';
import { Button, C, Empty, Loading, s } from '@/ui';

export default function Messages() {
  const { user } = useAuth();
  const socket = useSocket();
  const q = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<CursorPage<ConversationDto>>('/conversations'), enabled: !!user });
  useEffect(() => {
    if (!socket) return;
    const r = () => void q.refetch();
    socket.on('message:new', r);
    socket.on('conversation:read', r);
    return () => {
      socket.off('message:new', r);
      socket.off('conversation:read', r);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);
  if (!user) {
    return (
      <View style={[s.screen, { padding: 16 }]}>
        <Empty title="Войдите, чтобы переписываться" />
        <Button title="Войти" onPress={() => router.push('/auth/login')} />
      </View>
    );
  }
  return (
    <FlatList
      style={s.screen}
      data={q.data?.items ?? []}
      keyExtractor={(c) => c.id}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
      ListEmptyComponent={q.isLoading ? <Loading /> : q.isError ? <Empty title="Ошибка" text={errorMessage(q.error)} /> : <Empty title="Диалогов пока нет" text="Напишите продавцу со страницы объявления" />}
      renderItem={({ item: c }) => (
        <Pressable accessibilityRole="button" onPress={() => router.push(`/chat/${c.id}`)} style={{ flexDirection: 'row', gap: 12, padding: 12, backgroundColor: C.white, borderBottomWidth: 1, borderColor: C.bg }}>
          <Image source={c.listing.photo?.thumb ? { uri: c.listing.photo.thumb } : undefined} style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: C.bg }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }} numberOfLines={1}>{c.counterpart.displayName}</Text>
              {c.unreadCount > 0 && (
                <View style={{ backgroundColor: C.brand, borderRadius: 10, paddingHorizontal: 7 }}>
                  <Text style={{ color: C.white, fontWeight: '700', fontSize: 12 }}>{c.unreadCount}</Text>
                </View>
              )}
            </View>
            <Text style={{ color: C.muted }} numberOfLines={1}>{c.listing.title}</Text>
            <Text numberOfLines={1}>{c.lastMessage?.type === 'image' ? '📷 Фото' : (c.lastMessage?.body ?? '')}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}
