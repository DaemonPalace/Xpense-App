import { router } from 'expo-router';
import { useState } from 'react';

import { Body, Button, ErrorText, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { CONSENT_VERSION, t } from '@/strings';

export default function Consent() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    setBusy(true);
    setError('');
    try {
      await api('POST', '/api/me/consent', { version: CONSENT_VERSION });
      router.replace('/');
    } catch {
      setError(t.common.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>{t.consent.title}</Title>
      {t.consent.body.map((p) => (
        <Body key={p}>{p}</Body>
      ))}
      <ErrorText>{error}</ErrorText>
      <Button label={t.consent.accept} onPress={accept} busy={busy} />
    </Screen>
  );
}
