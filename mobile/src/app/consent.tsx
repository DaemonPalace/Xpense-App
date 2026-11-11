import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { Button, colors, FormError, Page, SmallLink, Text } from '@/components/ui';
import { useAppData } from '@/data-context';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { useSession } from '@/session-context';
import { CONSENT_VERSION, t } from '@/strings';

export default function Consent() {
  const { refresh } = useAppData();
  const { signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    setBusy(true);
    setError('');
    try {
      await api('POST', '/api/me/consent', { version: CONSENT_VERSION });
      await refresh();
      router.replace('/hoy');
    } catch {
      setError(t.common.genericError);
    } finally {
      setBusy(false);
    }
  }

  return <Page title={t.consent.title} back={false}>
    {t.consent.body.map(p => <View key={p} className="mb-4 flex-row gap-3">
      <Ionicons name="shield-checkmark-outline" size={22} color={colors.brand} />
      <Text className="flex-1 text-[15px] leading-6 text-ink">{p}</Text>
    </View>)}
    <View className="mb-4"><SmallLink label={t.consent.policy} onPress={() => void Linking.openURL(`${config.apiUrl}/privacy.html`)} /></View>
    <FormError message={error} />
    <Button label={t.consent.accept} onPress={accept} busy={busy} className="mt-2 w-full" />
    <Button variant="ghost" label={t.settings.signOut} onPress={signOut} className="mt-2 w-full" />
  </Page>;
}
