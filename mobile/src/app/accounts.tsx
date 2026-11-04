import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Body, Button, ErrorText, Screen } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api, waitForJob, type Account, type Job } from '@/lib/api';
import { t } from '@/strings';

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setAccounts(await api<Account[]>('GET', '/api/accounts'));
    } catch {
      setError(t.common.genericError);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /** Runs a step that starts a background job, then waits for it and reports counts. */
  async function withJob(start: () => Promise<string | null>) {
    setBusy(true);
    setError('');
    setMessage(t.accounts.working);
    try {
      const jobId = await start();
      await load();
      if (jobId) {
        const job: Job = await waitForJob(jobId);
        setMessage(job.status === 'succeeded' ? t.accounts.jobDone(job.imported, job.skipped, job.rejected) : t.accounts.jobFailed(job.failureReason ?? ''));
      } else setMessage('');
    } catch {
      setMessage('');
      setError(t.common.genericError);
    } finally {
      setBusy(false);
      load();
    }
  }

  const connect = (type: 'checking' | 'credit_card') =>
    withJob(async () => {
      const name = type === 'checking' ? t.accounts.checkingName : t.accounts.cardName;
      const r = await api<{ job: Job | null }>('POST', '/api/accounts', { name, type, source: 'simulated' });
      return r.job?.jobId ?? null;
    });

  const importCsv = async () => {
    const pick = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'], copyToCacheDirectory: true });
    if (pick.canceled) return;
    const file = pick.assets[0];
    withJob(async () => {
      const csvAccount =
        accounts.find((a) => a.source === 'csv') ??
        (await api<{ account: Account }>('POST', '/api/accounts', { name: t.accounts.csvAccountName, type: 'checking', source: 'csv' })).account;
      const { job, upload } = await api<{ job: Job; upload: { url: string; fields: Record<string, string> } }>('POST', '/api/imports', { accountId: csvAccount.accountId });
      const form = new FormData();
      Object.entries(upload.fields).forEach(([k, v]) => form.append(k, v));
      form.append('file', { uri: file.uri, name: file.name, type: 'text/csv' } as any); // RN FormData file shape
      const res = await fetch(upload.url, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`upload ${res.status}`);
      await api('POST', `/api/imports/${job.jobId}/start`);
      return job.jobId;
    });
  };

  const sync = (a: Account) => withJob(async () => (await api<Job>('POST', `/api/accounts/${a.accountId}/sync`)).jobId);

  const unlink = (a: Account) =>
    Alert.alert(t.accounts.unlinkTitle, a.name, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.accounts.keep, onPress: () => withJob(async () => (await api('DELETE', `/api/accounts/${a.accountId}?deleteTransactions=false`), null)) },
      { text: t.accounts.remove, style: 'destructive', onPress: () => withJob(async () => (await api('DELETE', `/api/accounts/${a.accountId}?deleteTransactions=true`), null)) },
    ]);

  return (
    <Screen>
      <Body>{t.accounts.intro}</Body>
      {accounts.length === 0 && <Body muted>{t.accounts.empty}</Body>}
      {accounts.map((a) => (
        <View key={a.accountId} style={styles.card}>
          <Text style={styles.name}>{a.name}</Text>
          <Text style={[styles.muted, a.status === 'failed' && { color: Colors.danger }]}>
            {t.accounts.status[a.status] ?? a.status}
            {a.failureReason ? ` · ${a.failureReason}` : ''}
          </Text>
          {a.lastSyncedAt && <Text style={styles.muted}>{t.accounts.lastSync(new Date(a.lastSyncedAt).toLocaleString('es-CO'))}</Text>}
          <View style={styles.actions}>
            {a.source === 'simulated' && <Button variant="link" label={t.accounts.sync} onPress={() => sync(a)} disabled={busy || a.status === 'syncing'} />}
            <Button variant="link" label={t.accounts.unlink} onPress={() => unlink(a)} disabled={busy} />
          </View>
        </View>
      ))}
      {message ? <Body>{message}</Body> : null}
      <ErrorText>{error}</ErrorText>
      <Button label={t.accounts.connectChecking} onPress={() => connect('checking')} busy={busy} />
      <Button label={t.accounts.connectCard} onPress={() => connect('credit_card')} disabled={busy} />
      <Body muted>{t.accounts.testBankNote}</Body>
      <Button variant="link" label={t.accounts.importCsv} onPress={importCsv} disabled={busy} />
      <Body muted>{t.accounts.csvHint}</Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  name: { fontSize: 17, fontWeight: '600', color: Colors.text },
  muted: { fontSize: 14, color: Colors.textSecondary },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
