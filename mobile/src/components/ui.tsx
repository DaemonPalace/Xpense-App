import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { CognitoError } from '@/lib/cognito';
import { Colors, Spacing } from '@/constants/theme';
import { t } from '@/strings';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: Colors.textSecondary }]}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
      {children}
    </Text>
  );
}

export function Button({ label, onPress, busy, disabled, variant = 'primary' }: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'link' | 'danger';
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles[variant], off && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
      {busy ? <ActivityIndicator color={Colors.text} /> : <Text style={[styles.buttonText, variant !== 'primary' && styles[`${variant}Text`]]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: Spacing.one }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={Colors.textSecondary} style={[styles.input, style]} {...props} />
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, selected && { backgroundColor: Colors.greenYellow, borderColor: Colors.accentText }]}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {children}
    </View>
  );
}

export function errorMessage(e: unknown): string {
  if (e instanceof CognitoError) return t.cognitoErrors[e.code] ?? t.common.genericError;
  return t.common.genericError;
}

const styles = StyleSheet.create({
  screen: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  title: { fontSize: 26, fontWeight: '700', color: Colors.text },
  body: { fontSize: 16, lineHeight: 22, color: Colors.text },
  error: { color: Colors.danger, fontSize: 15 },
  label: { fontSize: 15, color: Colors.textSecondary },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    fontSize: 17,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  button: { minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  primary: { backgroundColor: Colors.greenYellow },
  link: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.danger },
  buttonText: { fontSize: 17, fontWeight: '600', color: Colors.text },
  linkText: { color: Colors.accentText, fontWeight: '500' },
  dangerText: { color: Colors.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipText: { fontSize: 15, color: Colors.text },
});
