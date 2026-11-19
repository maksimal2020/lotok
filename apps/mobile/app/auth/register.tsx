import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { registerSchema } from '@lotok/shared';
import { errorMessage } from '@/api';
import { useAuth } from '@/auth';
import { Button, C, Card, Field, s } from '@/ui';

export default function Register() {
  const auth = useAuth();
  const [f, setF] = useState({ displayName: '', email: '', password: '' });
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 12 }}>
        {error && <Text style={{ color: C.danger }}>{error}</Text>}
        <Field label="Имя" value={f.displayName} onChangeText={(v) => setF({ ...f, displayName: v })} error={errors.displayName} />
        <Field label="Email" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} keyboardType="email-address" autoCapitalize="none" error={errors.email} />
        <Field label="Пароль" value={f.password} onChangeText={(v) => setF({ ...f, password: v })} secureTextEntry error={errors.password} />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agree }} onPress={() => setAgree(!agree)}>
          <Text>{agree ? '☑' : '☐'} Принимаю пользовательское соглашение и даю согласие на обработку персональных данных</Text>
        </Pressable>
        <Button
          title="Зарегистрироваться"
          loading={busy}
          onPress={async () => {
            const parsed = registerSchema.safeParse({ ...f, acceptTerms: agree, acceptPersonalData: agree });
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
              return;
            }
            setErrors({});
            setBusy(true);
            try {
              await auth.register(f);
              router.back();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        />
        <Text style={{ color: C.muted }}>Мы отправим письмо для подтверждения email.</Text>
      </Card>
    </ScrollView>
  );
}
