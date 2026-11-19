import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { formatMoney } from '@lotok/shared';
import { useAuth } from '@/auth';
import { Button, C, Card, s } from '@/ui';

export default function Profile() {
  const { user, logout } = useAuth();
  if (!user) {
    return (
      <View style={[s.screen, { padding: 16, gap: 12 }]}>
        <Text style={s.h1}>Добро пожаловать на Лоток</Text>
        <Text style={{ color: C.muted }}>Войдите, чтобы публиковать объявления, переписываться и покупать с доставкой.</Text>
        <Button title="Войти" onPress={() => router.push('/auth/login')} />
        <Button variant="outline" title="Зарегистрироваться" onPress={() => router.push('/auth/register')} />
      </View>
    );
  }
  const links: [string, string][] = [
    ['Мои объявления', '/my-listings'],
    ['Избранное', '/favorites'],
    ['Заказы', '/orders'],
  ];
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 12, gap: 12 }}>
      <Card style={{ gap: 4 }}>
        <Text style={s.h1}>{user.displayName}</Text>
        <Text style={{ color: C.muted }}>{user.email ?? user.phone}</Text>
        <Text style={{ color: C.muted }}>
          Рейтинг: {user.ratingAvg ? `${user.ratingAvg.toFixed(1)} (${user.ratingCount})` : 'нет отзывов'} · бонусы {formatMoney(user.bonusBalance)}
        </Text>
        {!user.emailVerified && !user.phoneVerified && <Text style={{ color: C.danger }}>Подтвердите email или телефон, чтобы публиковать объявления.</Text>}
      </Card>
      {links.map(([title, href]) => (
        <Pressable key={href} accessibilityRole="link" onPress={() => router.push(href as never)}>
          <Card>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>{title}</Text>
          </Card>
        </Pressable>
      ))}
      <Button
        variant="outline"
        title="Выйти"
        onPress={() =>
          Alert.alert('Выйти из аккаунта?', undefined, [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Выйти', style: 'destructive', onPress: () => void logout() },
          ])
        }
      />
    </ScrollView>
  );
}
