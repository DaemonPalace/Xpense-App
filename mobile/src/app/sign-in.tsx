import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, colors, errorMessage, Field, FormError, GradientTile, Page, Text } from '@/components/ui';
import { CognitoError } from '@/lib/cognito';
import { useSession } from '@/session-context';
import { t } from '@/strings';

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!email || !password) return;
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (e) {
      if (e instanceof CognitoError && e.code === 'UserNotConfirmedException') {
        router.push({ pathname: '/sign-up', params: { email: email.trim().toLowerCase(), confirm: '1' } });
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return <Page>
    <View className="flex-1 justify-center">
      <GradientTile colors={['#0B4F4A', '#0F766E']} className="mb-6">
        <View className="min-h-[200px] justify-between p-6">
          <View className="flex-row items-center gap-3"><View className="h-11 w-11 items-center justify-center rounded-2xl bg-white"><Ionicons name="wallet" size={24} color={colors.brand} /></View><Text className="font-heavy text-2xl text-white">{t.appName}</Text></View>
          <Text accessibilityRole="header" className="font-heavy text-[28px] leading-[34px] text-white">Disfruta la U.{'\n'}Cuida tu futuro.</Text>
        </View>
      </GradientTile>
      <Text className="mb-5 text-sm leading-5 text-muted">{t.auth.tagline}</Text>
      <Field label={t.common.email} value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label={t.common.password} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
      <FormError message={error} />
      <Button label={t.auth.signIn} onPress={submit} busy={busy} disabled={!email || !password} className="w-full" />
      <Button variant="ghost" label={t.auth.noAccount} onPress={() => router.push('/sign-up')} className="mt-2 w-full" />
      <Button variant="ghost" label={t.auth.forgot} onPress={() => router.push({ pathname: '/reset-password', params: { email } })} className="w-full" />
    </View>
  </Page>;
}
