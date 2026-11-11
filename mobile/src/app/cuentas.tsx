import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { Button, Callout, Card, CardHeading, Chip, FormError, IconTile, Page, SmallLink, Text } from '@/components/ui';
import { useAppData } from '@/data-context';
import { api, waitForJob, type Account, type Job } from '@/lib/api';
import { t } from '@/strings';

export default function Cuentas() {
  const { refresh } = useAppData();
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
  useFocusEffect(useCallback(() => void load(), [load]));

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
      refresh();
    }
  }

  const connect = (type: 'checking' | 'credit_card') => withJob(async () => {
    const name = type === 'checking' ? t.accounts.checkingName : t.accounts.cardName;
    const r = await api<{ job: Job | null }>('POST', '/api/accounts', { name, type, source: 'simulated' });
    return r.job?.jobId ?? null;
  });

  const importCsv = async () => {
    const pick = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'], copyToCacheDirectory: true });
    if (pick.canceled) return;
    const file = pick.assets[0];
    withJob(async () => {
      const csvAccount = accounts.find(a => a.source === 'csv')
        ?? (await api<{ account: Account }>('POST', '/api/accounts', { name: t.accounts.csvAccountName, type: 'checking', source: 'csv' })).account;
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
  const unlink = (a: Account) => Alert.alert(t.accounts.unlinkTitle, a.name, [
    { text: t.common.cancel, style: 'cancel' },
    { text: t.accounts.keep, onPress: () => withJob(async () => (await api('DELETE', `/api/accounts/${a.accountId}?deleteTransactions=false`), null)) },
    { text: t.accounts.remove, style: 'destructive', onPress: () => withJob(async () => (await api('DELETE', `/api/accounts/${a.accountId}?deleteTransactions=true`), null)) },
  ]);

  return <Page title={t.accounts.title}>
    <Text className="mb-5 text-sm leading-5 text-muted">{t.accounts.intro}</Text>
    {accounts.map(a => <Card key={a.accountId} className="mb-3">
      <View className="flex-row items-center gap-3">
        <IconTile icon={a.source === 'csv' ? 'document-text-outline' : a.type === 'credit_card' ? 'card-outline' : 'business-outline'} background="#DDF3EF" color="#0F766E" />
        <View className="flex-1">
          <Text className="font-strong text-[15px] text-ink">{a.name}</Text>
          {a.lastSyncedAt ? <Text className="text-xs text-muted">{t.accounts.lastSync(new Date(a.lastSyncedAt).toLocaleString('es-CO'))}</Text> : null}
          {a.failureReason ? <Text className="text-xs text-danger">{a.failureReason}</Text> : null}
        </View>
        <Chip label={t.accounts.status[a.status] ?? a.status} tone={a.status === 'failed' ? 'amber' : a.status === 'synced' ? 'green' : 'brand'} />
      </View>
      <View className="mt-2 flex-row gap-4">
        {a.source === 'simulated' && !busy && a.status !== 'syncing' ? <SmallLink label={t.accounts.sync} onPress={() => sync(a)} /> : null}
        {!busy ? <SmallLink label={t.accounts.unlink} onPress={() => unlink(a)} /> : null}
      </View>
    </Card>)}
    {!accounts.length ? <Text className="mb-4 text-sm text-muted">{t.accounts.empty}</Text> : null}
    {message ? <View className="mb-4"><Callout tone="brand" icon="sync-outline" title={message} /></View> : null}
    <FormError message={error} />

    <Card className="mb-5 mt-2">
      <CardHeading title="Banco de prueba" subtitle={t.accounts.testBankNote} />
      <Button label={t.accounts.connectChecking} icon="business-outline" onPress={() => connect('checking')} busy={busy} className="mb-3 w-full" />
      <Button label={t.accounts.connectCard} icon="card-outline" variant="secondary" onPress={() => connect('credit_card')} disabled={busy} className="w-full" />
    </Card>
    <Card>
      <CardHeading title={t.accounts.importCsv} subtitle={t.accounts.csvHint} />
      <Button label="Elegir archivo" icon="document-attach-outline" variant="secondary" onPress={importCsv} disabled={busy} className="w-full" />
    </Card>
  </Page>;
}
