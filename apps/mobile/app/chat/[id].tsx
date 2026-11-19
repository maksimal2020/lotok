import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import type { CursorPage, MessageDto } from '@lotok/shared';
import { api, errorMessage } from '@/api';
import { useAuth } from '@/auth';
import { useSocket } from '@/socket';
import { Button, C, Loading, s } from '@/ui';

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const socket = useSocket();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<MessageDto>>(null);
  const q = useQuery({ queryKey: ['m-messages', id], queryFn: () => api.get<CursorPage<MessageDto>>(`/conversations/${id}/messages`, { limit: 100 }) });

  useEffect(() => {
    void api.post(`/conversations/${id}/read`).catch(() => undefined);
    if (!socket) return;
    const onNew = (m: MessageDto) => {
      if (m.conversationId !== id) return;
      qc.setQueryData(['m-messages', id], (old: CursorPage<MessageDto> | undefined) => (old && !old.items.some((x) => x.id === m.id) ? { ...old, items: [...old.items, m] } : old));
      if (m.senderId !== user?.id) void api.post(`/conversations/${id}/read`).catch(() => undefined);
    };
    // Переподключение после потери сети — досинхронизация истории.
    const onConnect = () => void q.refetch();
    socket.on('message:new', onNew);
    socket.on('connect', onConnect);
    return () => {
      socket.off('message:new', onNew);
      socket.off('connect', onConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, id, user?.id]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    setError(null);
    const clientMessageId = `m${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    try {
      const m = socket?.connected
        ? ((await socket.timeout(10_000).emitWithAck('message:send', { conversationId: id, body, clientMessageId })) as { ok: boolean; data: MessageDto; message?: string })
        : { ok: true, data: await api.post<MessageDto>(`/conversations/${id}/messages`, { body, clientMessageId }) };
      if (!m.ok) throw new Error(m.message);
      qc.setQueryData(['m-messages', id], (old: CursorPage<MessageDto> | undefined) => (old && !old.items.some((x) => x.id === m.data.id) ? { ...old, items: [...old.items, m.data] } : old));
    } catch (e) {
      setText(body);
      setError(errorMessage(e));
    }
  };

  if (q.isLoading) return <Loading />;
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={list}
        data={q.data?.items ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, gap: 6 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        renderItem={({ item: m }) => {
          const mine = m.senderId === user?.id;
          return (
            <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%', backgroundColor: mine ? C.brand : C.white, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Text style={{ color: mine ? C.white : C.ink }}>{m.type === 'image' ? '📷 Фото' : m.body}</Text>
              {mine && <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, textAlign: 'right' }}>{m.readAt ? 'прочитано' : m.deliveredAt ? 'доставлено' : 'отправлено'}</Text>}
            </View>
          );
        }}
      />
      {error && <Text style={{ color: C.danger, paddingHorizontal: 12 }}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: 8, padding: 10, backgroundColor: C.white }}>
        <TextInput accessibilityLabel="Сообщение" value={text} onChangeText={setText} placeholder="Сообщение" style={[s.input, { flex: 1 }]} maxLength={4000} />
        <Button title="➤" onPress={send} style={{ width: 52 }} />
      </View>
    </KeyboardAvoidingView>
  );
}
