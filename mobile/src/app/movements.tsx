import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Chip, ErrorText } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api, type Summary, type Transaction } from '@/lib/api';
import { formatCOP } from '@/lib/money';
import { t } from '@/strings';

export default function Movements() {
  const params = useLocalSearchParams<{ category?: string; ant?: string }>();
  const [category, setCategory] = useState(params.category ?? '');
  const [antOnly, setAntOnly] = useState(params.ant === '1');
  const [items, setItems] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [ant, setAnt] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const load = useCallback(
    async (after?: string | null) => {
      try {
        const s = await api<Summary>('GET', '/api/summary');
        setAnt(new Set(s.ant.txnIds));
        const q = new URLSearchParams({ from: `${s.month}-01`, to: s.today });
        if (category) q.set('category', category);
        if (after) q.set('cursor', after);
        const page = await api<{ items: Transaction[]; cursor: string | null }>('GET', `/api/transactions?${q}`);
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.cursor);
        setError('');
      } catch {
        setError(t.common.genericError);
      }
    },
    [category],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function confirmDelete(tx: Transaction) {
    if (tx.origin === 'vault') return; // reversed from the vault screen
    Alert.alert(t.movements.deleteTitle, `${tx.description} · ${formatCOP(tx.amountMinor)}`, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.movements.delete,
        style: 'destructive',
        onPress: async () => {
          try {
            await api('DELETE', `/api/transactions/${tx.txnId}?date=${tx.date}`);
            setItems((xs) => xs.filter((x) => x.txnId !== tx.txnId));
          } catch {
            setError(t.common.genericError);
          }
        },
      },
    ]);
  }

  const shown = antOnly ? items.filter((x) => ant.has(x.txnId)) : items;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: category ? t.categories[category] : t.movements.title }} />
      <View style={styles.filters}>
        <Chip label={t.movements.all} selected={!antOnly && !category} onPress={() => (setAntOnly(false), setCategory(''))} />
        <Chip label={t.movements.ant} selected={antOnly} onPress={() => setAntOnly((v) => !v)} />
      </View>
      <ErrorText>{error}</ErrorText>
      <FlatList
        data={shown}
        keyExtractor={(x) => x.txnId}
        contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
        ListEmptyComponent={<Text style={styles.muted}>{t.movements.empty}</Text>}
        ListFooterComponent={cursor ? <Button variant="link" label={t.movements.more} onPress={() => load(cursor)} /> : undefined}
        renderItem={({ item }) => (
          <Pressable onLongPress={() => confirmDelete(item)} accessibilityRole="button" accessibilityHint={t.movements.deleteTitle} style={styles.item}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.desc} numberOfLines={1}>
                {item.description}
              </Text>
              <Text style={styles.muted}>
                {item.date} · {t.categories[item.category] ?? (item.category === 'savings' ? t.vault.title : item.category)}
                {ant.has(item.txnId) ? ` · ${t.movements.ant}` : ''}
              </Text>
            </View>
            <Text style={[styles.amount, item.type === 'savings' && { color: Colors.accentText }]}>{formatCOP(item.amountMinor)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: Colors.surface, borderRadius: 10, padding: Spacing.three, minHeight: 56 },
  desc: { fontSize: 16, color: Colors.text },
  muted: { fontSize: 14, color: Colors.textSecondary },
  amount: { fontSize: 16, fontWeight: '600', color: Colors.text },
});
