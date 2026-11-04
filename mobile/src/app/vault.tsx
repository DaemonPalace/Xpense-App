import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Button, ErrorText, Field, Screen } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';
import { formatCOP, parsePesos } from '@/lib/money';
import { t } from '@/strings';

export default function Vault() {
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const amountMinor = parsePesos(amount);

  useFocusEffect(
    useCallback(() => {
      api<{ balanceMinor: number }>('GET', '/api/vault').then((v) => setBalance(v.balanceMinor), () => setError(t.common.genericError));
    }, []),
  );

  async function move(op: 'deposit' | 'withdraw') {
    if (!amountMinor) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ balanceMinor: number }>('POST', `/api/vault/${op}`, { amountMinor });
      setBalance(r.balanceMinor);
      setAmount('');
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'insufficient_vault' ? t.vault.insufficient : t.common.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Body muted>{t.vault.intro}</Body>
      <View style={styles.card} accessible accessibilityLabel={`${t.vault.balance}: ${balance === null ? '' : formatCOP(balance)}`}>
        <Text style={styles.label}>{t.vault.balance}</Text>
        <Text style={styles.amount}>{balance === null ? '—' : formatCOP(balance)}</Text>
      </View>
      <Field label={t.vault.amount} value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="$ 0" />
      <ErrorText>{error}</ErrorText>
      <Button label={t.vault.deposit} onPress={() => move('deposit')} busy={busy} disabled={!amountMinor} />
      <Button variant="link" label={t.vault.withdraw} onPress={() => move('withdraw')} disabled={busy || !amountMinor} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderLeftWidth: 6, borderLeftColor: Colors.greenYellow, borderRadius: 12, padding: Spacing.four, gap: Spacing.one },
  label: { color: Colors.textSecondary, fontSize: 15 },
  amount: { color: Colors.text, fontSize: 34, fontWeight: '700' },
});
