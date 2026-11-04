import { router } from 'expo-router';
import { useState } from 'react';

import { Body, Button, ErrorText, Field, Screen, Title, errorMessage } from '@/components/ui';
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

  return (
    <Screen>
      <Title>{t.auth.signInTitle}</Title>
      <Body muted>{t.auth.tagline}</Body>
      <Field label={t.common.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label={t.common.password} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
      <ErrorText>{error}</ErrorText>
      <Button label={t.auth.signIn} onPress={submit} busy={busy} disabled={!email || !password} />
      <Button variant="link" label={t.auth.noAccount} onPress={() => router.push('/sign-up')} />
      <Button variant="link" label={t.auth.forgot} onPress={() => router.push({ pathname: '/reset-password', params: { email } })} />
    </Screen>
  );
}
