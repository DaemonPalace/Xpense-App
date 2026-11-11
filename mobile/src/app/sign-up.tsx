import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button, Checklist, errorMessage, Field, FormError, Page, Select, Text } from '@/components/ui';
import * as cognito from '@/lib/cognito';
import { missingRules, PASSWORD_RULES } from '@/lib/password';
import { useSession } from '@/session-context';
import { INSTITUTIONS, t } from '@/strings';

export default function SignUp() {
  const params = useLocalSearchParams<{ email?: string; confirm?: string }>();
  const { signIn } = useSession();
  const [step, setStep] = useState<'form' | 'confirm'>(params.confirm ? 'confirm' : 'form');
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [institution, setInstitution] = useState<string>(INSTITUTIONS.length === 1 ? INSTITUTIONS[0] : '');
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

  function register() {
    if (!givenName.trim() || !familyName.trim() || !institution || !email) return setError('Completa todos los campos.');
    const missing = missingRules(password);
    if (missing.length) return setError(t.auth.passwordMissing(missing));
    run(async () => {
      await cognito.signUp(normalized, password, { givenName: givenName.trim(), familyName: familyName.trim(), institution });
      setStep('confirm');
    });
  }

  if (step === 'form') return <Page title={t.auth.signUpTitle}>
    <Field label={t.auth.givenName} value={givenName} onChangeText={setGivenName} autoCapitalize="words" autoComplete="given-name" textContentType="givenName" maxLength={60} />
    <Field label={t.auth.familyName} value={familyName} onChangeText={setFamilyName} autoCapitalize="words" autoComplete="family-name" textContentType="familyName" maxLength={60} />
    <Select label={t.auth.institution} value={institution} options={INSTITUTIONS} onChange={setInstitution} placeholder={t.auth.institutionPick} />
    <Field label={t.common.email} value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
    <Field label={t.common.password} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword">
      <Checklist items={PASSWORD_RULES.map(r => ({ label: r.label, ok: r.ok(password) }))} />
    </Field>
    <FormError message={error} />
    <Button label={t.auth.signUp} busy={busy} onPress={register} className="w-full" />
    <Button variant="ghost" label={t.auth.haveAccount} onPress={() => router.back()} className="mt-2 w-full" />
  </Page>;

  return <Page title={t.auth.signUpTitle}>
    <Text className="mb-5 text-[15px] leading-6 text-ink">{t.auth.codeSent(normalized)}</Text>
    <Field label={t.common.code} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" />
    <FormError message={error} />
    {info ? <Text className="mb-4 text-sm text-muted">{info}</Text> : null}
    <Button label={t.auth.confirm} busy={busy} disabled={!code} className="w-full"
      onPress={() => run(async () => {
        await cognito.confirmSignUp(normalized, code.trim());
        // Coming from sign-in (unconfirmed account) we don't have the password: go back and sign in.
        if (password) await signIn(normalized, password);
        else router.back();
      })} />
    <Button variant="ghost" label={t.auth.resend} className="mt-2 w-full" onPress={() => run(async () => (await cognito.resendCode(normalized), setInfo(t.auth.resent)))} />
  </Page>;
}
