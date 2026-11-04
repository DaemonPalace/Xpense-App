import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { Body, Button, ErrorText, Field, Screen } from '@/components/ui';
import { api, type Summary } from '@/lib/api';
import { parsePesos } from '@/lib/money';
import { useSession } from '@/session-context';
import { t } from '@/strings';

export default function Settings() {
  const { signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [threshold, setThreshold] = useState('');
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      api<Summary>('GET', '/api/summary').then((s) => setThreshold(String(s.antThresholdMinor / 100)), () => {});
    }, []),
  );

  async function saveThreshold() {
    const antThresholdMinor = parsePesos(threshold);
    if (!antThresholdMinor) return;
    try {
      await api('PATCH', '/api/me', { antThresholdMinor });
      setSaved(true);
    } catch {
      setError(t.common.genericError);
    }
  }

  function confirmDelete() {
    Alert.alert(t.settings.deleteConfirmTitle, t.settings.deleteConfirmBody, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.settings.deleteConfirm,
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setError('');
          try {
            await api('DELETE', '/api/me');
            await signOut();
          } catch {
            setError(t.common.genericError);
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <Field label={t.settings.antThreshold} value={threshold} onChangeText={(v) => (setThreshold(v), setSaved(false))} keyboardType="number-pad" onEndEditing={saveThreshold} />
      {saved && <Body muted>{t.settings.antSaved}</Body>}
      <Button label={t.settings.signOut} onPress={signOut} />
      <ErrorText>{error}</ErrorText>
      <Button variant="danger" label={t.settings.delete} onPress={confirmDelete} busy={busy} />
    </Screen>
  );
}
