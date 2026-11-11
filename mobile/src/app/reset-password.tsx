import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Button, Checklist, errorMessage, Field, FormError, Page, Text } from '@/components/ui';
import * as cognito from '@/lib/cognito';
import { missingRules, PASSWORD_RULES } from '@/lib/password';
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

  return <Page title={t.auth.resetTitle}>
    {step === 'email' ? <>
      <Field label={t.common.email} value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" />
      <FormError message={error} />
      <Button label={t.auth.sendCode} busy={busy} disabled={!email} className="w-full" onPress={() => run(async () => (await cognito.forgotPassword(normalized), setStep('code')))} />
    </> : <>
      <Text className="mb-5 text-[15px] leading-6 text-ink">{t.auth.codeSent(normalized)}</Text>
      <Field label={t.common.code} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" />
      <Field label={t.auth.newPassword} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword">
        <Checklist items={PASSWORD_RULES.map(r => ({ label: r.label, ok: r.ok(password) }))} />
      </Field>
      <FormError message={error} />
      <Button label={t.common.save} busy={busy} disabled={!code || !password} className="w-full"
        onPress={() => {
          const missing = missingRules(password);
          if (missing.length) return setError(t.auth.passwordMissing(missing));
          run(async () => {
          await cognito.confirmForgotPassword(normalized, code.trim(), password);
          Alert.alert(t.auth.resetDone);
          router.back();
          });
        }} />
    </>}
  </Page>;
}
