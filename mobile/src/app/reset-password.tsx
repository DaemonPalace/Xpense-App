import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Body, Button, ErrorText, Field, Screen, Title, errorMessage } from '@/components/ui';
import * as cognito from '@/lib/cognito';
import { t } from '@/strings';

export default function ResetPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const normalized = email.trim().toLowerCase();

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>{t.auth.resetTitle}</Title>
      {step === 'email' ? (
        <>
          <Field label={t.common.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
          <ErrorText>{error}</ErrorText>
          <Button label={t.auth.sendCode} busy={busy} disabled={!email} onPress={() => run(async () => (await cognito.forgotPassword(normalized), setStep('code')))} />
        </>
      ) : (
        <>
          <Body>{t.auth.codeSent(normalized)}</Body>
          <Field label={t.common.code} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" />
          <Field label={t.auth.newPassword} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          <Body muted>{t.auth.passwordHint}</Body>
          <ErrorText>{error}</ErrorText>
          <Button
            label={t.common.save}
            busy={busy}
            disabled={!code || !password}
            onPress={() =>
              run(async () => {
                await cognito.confirmForgotPassword(normalized, code.trim(), password);
                Alert.alert(t.auth.resetDone);
                router.back();
              })
            }
          />
        </>
      )}
    </Screen>
  );
}
