import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { formatMoney, tokens as t, type ListingCard } from '@lotok/shared';

export const C = {
  brand: t.colors.brand[500],
  brandDark: t.colors.brand[700],
  brandLight: t.colors.brand[50],
  accent: t.colors.accent[500],
  ink: t.colors.ink[900],
  muted: t.colors.ink[500],
  line: t.colors.ink[200],
  bg: t.colors.ink[50],
  white: '#fff',
  danger: t.colors.danger,
};

export function priceLabel(l: Pick<ListingCard, 'price' | 'priceType'>) {
  if (l.priceType === 'free') return 'Даром';
  if (l.priceType === 'on_request' || l.price === null) return 'Цена по запросу';
  return formatMoney(l.price);
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, style }: { title: string; onPress: () => void; variant?: 'primary' | 'outline' | 'accent' | 'danger'; loading?: boolean; disabled?: boolean; style?: ViewStyle }) {
  const bg = { primary: C.brand, outline: C.white, accent: C.accent, danger: C.danger }[variant];
  const fg = variant === 'outline' ? C.ink : variant === 'accent' ? C.ink : C.white;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1, borderWidth: variant === 'outline' ? 1 : 0 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={C.muted} style={[s.input, error ? { borderColor: C.danger } : null, props.multiline ? { minHeight: 110, textAlignVertical: 'top', paddingTop: 12 } : null]} {...props} />
      {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <View style={{ alignItems: 'center', padding: 40, gap: 8 }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: C.ink }}>{title}</Text>
      {text ? <Text style={{ color: C.muted, textAlign: 'center' }}>{text}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 40 }}>
      <ActivityIndicator color={C.brand} size="large" />
    </View>
  );
}

export function ListingTile({ l }: { l: ListingCard }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${l.title}, ${priceLabel(l)}`} onPress={() => router.push(`/listing/${l.id}`)} style={[s.tile, l.isHighlighted && { borderColor: C.accent, borderWidth: 2 }]}>
      <Image source={l.photo?.thumb ? { uri: l.photo.thumb } : undefined} style={s.tileImg} contentFit="cover" transition={150} />
      <View style={{ padding: 10, gap: 2 }}>
        <Text style={s.price}>{priceLabel(l)}</Text>
        <Text numberOfLines={2} style={{ color: C.ink, fontSize: 14 }}>
          {l.title}
        </Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>{l.cityName}</Text>
      </View>
    </Pressable>
  );
}

export const s = StyleSheet.create({
  btn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderColor: C.line },
  btnText: { fontWeight: '700', fontSize: 16 },
  label: { fontWeight: '600', color: t.colors.ink[700] },
  input: { height: 46, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, backgroundColor: C.white, color: C.ink },
  card: { backgroundColor: C.white, borderRadius: 14, padding: 16 },
  tile: { flex: 1, backgroundColor: C.white, borderRadius: 14, overflow: 'hidden', margin: 5 },
  tileImg: { width: '100%', aspectRatio: 4 / 3, backgroundColor: t.colors.ink[100] },
  price: { fontWeight: '800', fontSize: 16, color: C.ink },
  h1: { fontSize: 24, fontWeight: '800', color: C.ink },
  screen: { flex: 1, backgroundColor: C.bg },
});
