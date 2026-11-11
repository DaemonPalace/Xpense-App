import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';

import { Button, Card, CardHeading, colors, Field, FormError, Page, SmallLink, Text } from '@/components/ui';
import { useAppData } from '@/data-context';
import { api, ApiError } from '@/lib/api';
import { config } from '@/lib/config';
import { formatCOP, parsePesos } from '@/lib/money';
import { loadSession } from '@/lib/session';
import { useSession } from '@/session-context';
import { t } from '@/strings';

export default function Perfil() {
  const { signOut } = useSession();
  const { summary, refresh, notify, openSheet } = useAppData();
  const [user, setUser] = useState({ email: '', name: '' });
  const [threshold, setThreshold] = useState(summary ? String(summary.antThresholdMinor / 100) : '');
  const [withdraw, setWithdraw] = useState('');
  const [report, setReport] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Each error shows inside the card whose action failed.
  type Place = 'vault' | 'plan' | 'feedback' | 'session';
  const [error, setError] = useState<{ at: Place; message: string } | null>(null);
  const errorAt = (at: Place) => (error?.at === at ? error.message : '');
  useEffect(() => void loadSession().then(s => setUser({ email: s?.username ?? '', name: s?.name ?? '' })), []);

  async function run(at: Place, fn: () => Promise<unknown>, done: string, messageFor: (e: unknown) => string = () => t.common.genericError) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      notify(done);
      refresh();
    } catch (e) {
      setError({ at, message: messageFor(e) });
    } finally {
      setBusy(false);
    }
  }

  const saveThreshold = () => {
    const antThresholdMinor = parsePesos(threshold);
    if (!antThresholdMinor) return setError({ at: 'plan', message: 'Escribe un valor mayor a cero.' });
    if (antThresholdMinor !== summary?.antThresholdMinor) run('plan', () => api('PATCH', '/api/me', { antThresholdMinor }), t.settings.antSaved);
  };
  const doWithdraw = () => {
    const amountMinor = parsePesos(withdraw);
    if (amountMinor) run('vault', async () => (await api('POST', '/api/vault/withdraw', { amountMinor }), setWithdraw('')), 'Retiro registrado.',
      e => e instanceof ApiError && e.code === 'insufficient_vault' ? t.vault.insufficient : t.common.genericError);
  };
  const sendReport = () => run('feedback', async () => (await api('POST', '/api/feedback', { message: report, appVersion: Constants.expoConfig?.version }), setReport('')), t.feedback.sent);
  const confirmDelete = () => Alert.alert(t.settings.deleteConfirmTitle, t.settings.deleteConfirmBody, [
    { text: t.common.cancel, style: 'cancel' },
    { text: t.settings.deleteConfirm, style: 'destructive', onPress: async () => {
      setDeleting(true);
      setError(null);
      try {
        await api('DELETE', '/api/me');
        await signOut();
      } catch {
        setError({ at: 'session', message: t.common.genericError });
        setDeleting(false);
      }
    } },
  ]);

  return <Page title="Mi perfil">
    <Card className="mb-5 flex-row items-center gap-4">
      <View className="h-14 w-14 items-center justify-center rounded-full bg-brand"><Text className="font-heavy text-2xl text-white">{((user.name || user.email)[0] ?? '?').toUpperCase()}</Text></View>
      <View className="flex-1"><Text numberOfLines={1} className="font-strong text-lg text-ink">{user.name || user.email}</Text>{user.name ? <Text numberOfLines={1} className="text-sm text-muted">{user.email}</Text> : null}<Text className="text-sm text-muted">Ingreso mensual {formatCOP(summary?.inflowsMinor ?? 0)}</Text></View>
    </Card>

    <Pressable accessibilityRole="link" onPress={() => router.push('/cuentas')} className="mb-5 active:opacity-80">
      <Card className="flex-row items-center gap-3">
        <Ionicons name="card-outline" size={26} color={colors.brand} />
        <View className="flex-1"><Text className="font-strong text-[15px] text-ink">{t.accounts.title}</Text><Text className="text-sm leading-5 text-muted">Banco de prueba e importación de extractos CSV.</Text></View>
        <Ionicons name="chevron-forward" size={22} color={colors.muted} />
      </Card>
    </Pressable>

    <Card className="mb-5">
      <CardHeading title={t.vault.title} subtitle={t.vault.intro} />
      <Text className="mb-4 font-heavy text-[28px] text-ink">{formatCOP(summary?.vaultBalanceMinor ?? 0)}</Text>
      <Button label={t.vault.deposit} icon="arrow-up-circle-outline" onPress={() => openSheet('saving')} className="mb-4 w-full" />
      <Field label={`${t.vault.withdraw} (${t.vault.amount.toLowerCase()})`} money value={withdraw} onChangeText={setWithdraw} placeholder="0" />
      <FormError message={errorAt('vault')} />
      <Button label={t.vault.withdraw} variant="secondary" onPress={doWithdraw} disabled={busy || !parsePesos(withdraw)} className="w-full" />
    </Card>

    <Card className="mb-5">
      <CardHeading title="Plan y alertas" />
      <Button label="Ajustar mi plan" variant="secondary" onPress={() => openSheet('plan')} className="mb-4 w-full" />
      <Field label={t.settings.antThreshold} money value={threshold} onChangeText={setThreshold} onEndEditing={saveThreshold} helper="Las compras de este valor o menos que se repiten cuentan como gasto hormiga." />
      <FormError message={errorAt('plan')} />
    </Card>

    <Card className="mb-5">
      <CardHeading title={t.feedback.title} subtitle={t.feedback.intro} />
      <Field label={t.feedback.label} value={report} onChangeText={setReport} placeholder={t.feedback.placeholder} multiline maxLength={2000} autoCapitalize="sentences" textAlignVertical="top" style={{ minHeight: 96, paddingVertical: 12 }} />
      <FormError message={errorAt('feedback')} />
      <Button label={t.feedback.send} variant="secondary" icon="bug-outline" onPress={sendReport} disabled={busy || !report.trim()} className="mb-4 w-full" />
      <SmallLink label={t.consent.policy} onPress={() => void Linking.openURL(`${config.apiUrl}/privacy.html`)} />
    </Card>

    <Card>
      <CardHeading title="Sesión" />
      <Button label={t.settings.signOut} variant="ghost" icon="log-out-outline" onPress={signOut} className="mb-6 w-full" />
      <FormError message={errorAt('session')} />
      <Button label={t.settings.delete} variant="danger" icon="trash-outline" onPress={confirmDelete} busy={deleting} disabled={busy} className="w-full" />
    </Card>
  </Page>;
}
