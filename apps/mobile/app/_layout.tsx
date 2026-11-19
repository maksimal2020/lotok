import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/auth';
import { C } from '@/ui';

export default function RootLayout() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } }));
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerTintColor: C.brand, headerTitleStyle: { color: C.ink }, contentStyle: { backgroundColor: C.bg } }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="listing/[id]" options={{ title: 'Объявление' }} />
              <Stack.Screen name="chat/[id]" options={{ title: 'Диалог' }} />
              <Stack.Screen name="auth/login" options={{ title: 'Вход', presentation: 'modal' }} />
              <Stack.Screen name="auth/register" options={{ title: 'Регистрация', presentation: 'modal' }} />
              <Stack.Screen name="my-listings" options={{ title: 'Мои объявления' }} />
              <Stack.Screen name="orders" options={{ title: 'Заказы' }} />
              <Stack.Screen name="favorites" options={{ title: 'Избранное' }} />
            </Stack>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
