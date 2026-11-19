import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { errorMessage } from '@/api';
import { useAuth } from '@/auth';
import { Button, C, Card, Field, s } from '@/ui';

export default function Login() {
  const auth = useAuth();
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['email', 'phone'] as const).map((m) => (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => setMode(m)} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: mode === m ? C.ink : C.white }}>
            <Text style={{ textAlign: 'center', color: mode === m ? C.white : C.ink, fontWeight: '600' }}>{m === 'email' ? 'Email' : 'Телефон'}</Text>
          </Pressable>
        ))}
      </View>
      <Card style={{ gap: 12 }}>
        {error && <Text style={{ color: C.danger }}>{error}</Text>}
        {mode === 'email' ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <Field label="Пароль" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
            <Button title="Войти" loading={busy} onPress={() => run(async () => { await auth.login(email, password); router.back(); })} />
          </>
        ) : (
          <>
            <Field label="Телефон" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+7 900 000-00-00" editable={!sent} />
            {sent && <Field label="Код из SMS" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" />}
            {sent && (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: terms }} onPress={() => setTerms(!terms)}>
                <Text>{terms ? '☑' : '☐'} Для новых пользователей: принимаю условия и даю согласие на обработку персональных данных</Text>
              </Pressable>
            )}
            <Button
              title={sent ? 'Войти' : 'Получить код'}
              loading={busy}
              onPress={() =>
                run(async () => {
                  if (!sent) {
                    await auth.requestSms(phone);
                    setSent(true);
                  } else {
                    await auth.verifySms(phone, code, terms);
                    router.back();
                  }
                })
              }
            />
          </>
        )}
      </Card>
      <Button variant="outline" title="Создать аккаунт" onPress={() => router.replace('/auth/register')} />
    </ScrollView>
  );
}
