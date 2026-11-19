import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { C } from '@/ui';

export default function TabsLayout() {
  const { user } = useAuth();
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => api.get<{ messages: number }>('/conversations/unread'), enabled: !!user, refetchInterval: 30_000 });
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: C.brand, headerTitleStyle: { fontWeight: '800' } }}>
      <Tabs.Screen name="index" options={{ title: 'Главная', headerTitle: 'Лоток', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="search" options={{ title: 'Поиск', tabBarIcon: icon('search-outline') }} />
      <Tabs.Screen name="create" options={{ title: 'Разместить', tabBarIcon: icon('add-circle-outline') }} />
      <Tabs.Screen name="messages" options={{ title: 'Сообщения', tabBarIcon: icon('chatbubbles-outline'), tabBarBadge: unread.data?.messages || undefined }} />
      <Tabs.Screen name="profile" options={{ title: 'Профиль', tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}
