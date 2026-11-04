import { useState } from 'react';
import { Alert } from 'react-native';

import { Button, ErrorText, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/session-context';
import { t } from '@/strings';

export default function Settings() {
  const { signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
      <Button label={t.settings.signOut} onPress={signOut} />
      <ErrorText>{error}</ErrorText>
      <Button variant="danger" label={t.settings.delete} onPress={confirmDelete} busy={busy} />
    </Screen>
  );
}
