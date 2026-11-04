import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Body, Button, ErrorText, Field, Screen, Title, errorMessage } from '@/components/ui';
import * as cognito from '@/lib/cognito';
import { useSession } from '@/session-context';
import { t } from '@/strings';

export default function SignUp() {
  const params = useLocalSearchParams<{ email?: string; confirm?: string }>();
  const { signIn } = useSession();
  const [step, setStep] = useState<'form' | 'confirm'>(params.confirm ? 'confirm' : 'form');
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const normalized = email.trim().toLowerCase();

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'form') {
    return (
      <Screen>
        <Title>{t.auth.signUpTitle}</Title>
        <Field label={t.common.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
        <Field label={t.common.password} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
        <Body muted>{t.auth.passwordHint}</Body>
        <ErrorText>{error}</ErrorText>
        <Button
          label={t.auth.signUp}
          busy={busy}
          disabled={!email || !password}
          onPress={() => run(async () => (await cognito.signUp(normalized, password), setStep('confirm')))}
        />
        <Button variant="link" label={t.auth.haveAccount} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{t.auth.signUpTitle}</Title>
      <Body>{t.auth.codeSent(normalized)}</Body>
      <Field label={t.common.code} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" />
      <ErrorText>{error}</ErrorText>
      {info ? <Body muted>{info}</Body> : null}
      <Button
        label={t.auth.confirm}
        busy={busy}
        disabled={!code}
        onPress={() =>
          run(async () => {
            await cognito.confirmSignUp(normalized, code.trim());
            // Coming from sign-in (unconfirmed account) we don't have the password: go back and sign in.
            if (password) await signIn(normalized, password);
            else router.back();
          })
        }
      />
      <Button variant="link" label={t.auth.resend} onPress={() => run(async () => (await cognito.resendCode(normalized), setInfo(t.auth.resent)))} />
    </Screen>
  );
}
