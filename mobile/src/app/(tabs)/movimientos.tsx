import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { BarChart, Button, Callout, Card, CardHeading, Choice, colors, FormError, Progress, Screen, Segmented, styleFor, Text, TransactionList } from '@/components/ui';
import { useAppData } from '@/data-context';
import { api, type Transaction } from '@/lib/api';
import { formatCOP } from '@/lib/money';
import { t } from '@/strings';

export default function Movimientos() {
  const [view, setView] = useState<'lista' | 'resumen'>('lista');
  return <Screen title="Movimientos" fab>
    <View className="mb-5"><Segmented value={view} onChange={setView} options={[{ value: 'lista', label: 'Lista' }, { value: 'resumen', label: 'Resumen del mes' }]} /></View>
    {view === 'lista' ? <Lista /> : <Resumen />}
  </Screen>;
}

function Lista() {
  const { summary, refresh } = useAppData();
  const params = useLocalSearchParams<{ ant?: string }>();
  const [antOnly, setAntOnly] = useState(params.ant === '1');
  const [items, setItems] = useState<Transaction[] | null>(null); // null = first load in flight
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const ant = new Set(summary?.ant.txnIds);

  const load = useCallback(async (after?: string | null) => {
    if (!summary) return;
    try {
      const q = new URLSearchParams({ from: `${summary.month}-01`, to: summary.today });
      if (after) q.set('cursor', after);
      const page = await api<{ items: Transaction[]; cursor: string | null }>('GET', `/api/transactions?${q}`);
      setItems(prev => (after && prev ? [...prev, ...page.items] : page.items));
      setCursor(page.cursor);
      setError('');
    } catch {
      setItems(prev => prev ?? []);
      setError(t.common.genericError);
    }
  }, [summary]);
  useFocusEffect(useCallback(() => void load(), [load]));

  function confirmDelete(tx: Transaction) {
    if (tx.origin === 'vault') return Alert.alert('Este aporte no se elimina aquí', 'Para revertirlo, retira de la caja fuerte desde tu perfil.');
    Alert.alert(t.movements.deleteTitle, `${tx.description} · ${formatCOP(tx.amountMinor)}`, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.movements.delete, style: 'destructive', onPress: async () => {
        try {
          await api('DELETE', `/api/transactions/${tx.txnId}?date=${tx.date}`);
          setItems(xs => (xs ?? []).filter(x => x.txnId !== tx.txnId));
          refresh();
        } catch {
          setError(t.common.genericError);
        }
      } },
    ]);
  }

  const shown = (items ?? []).filter(x => !antOnly || ant.has(x.txnId));
  return <>
    <View className="mb-4 flex-row gap-2">
      <Choice label={t.movements.all} selected={!antOnly} onPress={() => setAntOnly(false)} />
      <Choice label={t.dashboard.ant} icon="bug-outline" selected={antOnly} onPress={() => setAntOnly(true)} />
    </View>
    <FormError message={error} />
    <Card>
      {items ? <TransactionList items={shown} ant={ant} onDelete={confirmDelete} /> : <ActivityIndicator accessibilityLabel="Cargando movimientos" color={colors.brand} className="py-6" />}
      {/* Also with the ant filter on: it only filters the pages loaded so far. */}
      {cursor ? <Button variant="ghost" label={t.movements.more} onPress={() => load(cursor)} /> : null}
    </Card>
  </>;
}

function Resumen() {
  const { summary: s } = useAppData();
  const [picked, setPicked] = useState<number | null>(null); // selected bar; null = current one
  if (!s) return null;
  // 5-day buckets over the month (dailyMinor has one entry per day of the month).
  const groups = Math.ceil(s.dailyMinor.length / 5);
  const values = Array.from({ length: groups }, (_, i) => s.dailyMinor.slice(i * 5, i * 5 + 5).reduce((a, v) => a + v, 0));
  const labels = values.map((_, i) => String(i * 5 + 1));
  const today = Number(s.today.slice(8, 10));
  const bar = picked ?? Math.floor((today - 1) / 5);
  const range = (i: number) => `Días ${i * 5 + 1}–${Math.min(i * 5 + 5, s.dailyMinor.length)}`;
  const byCategory = Object.entries(s.byCategoryMinor).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  return <>
    <Card className="mb-5">
      <Text className="text-sm text-muted">Gastaste este mes</Text>
      <Text accessibilityRole="header" className="mb-1 mt-1 font-heavy text-[36px] leading-[44px] text-ink">{formatCOP(s.spentMinor)}</Text>
      <Text className="mb-5 text-sm text-muted">{t.home.used(s.pctUsed)}</Text>
      <Text accessibilityLiveRegion="polite" className="mb-3 text-sm text-ink"><Text className="font-semi text-sm text-ink">{range(bar)}</Text>: {formatCOP(values[bar])}</Text>
      <BarChart values={values} labels={labels} highlight={bar} onSelect={setPicked} describe={range} height={150} floor={10_000_000} />
      {s.ant.count ? <View className="mt-5"><Callout title={t.dashboard.ant}>{t.dashboard.antSummary(s.ant.count, formatCOP(s.ant.totalMinor))}</Callout></View> : null}
    </Card>
    <Card>
      <CardHeading title={t.dashboard.byCategory} />
      {byCategory.length ? byCategory.map(([c, v]) => <View key={c} className="mb-4">
        <View className="mb-2 flex-row items-center justify-between"><Text className="text-sm text-ink">{t.categories[c] ?? c}</Text><Text className="font-strong text-sm text-ink">{formatCOP(v)} · {Math.round(v / s.spentMinor * 100)}%</Text></View>
        <Progress value={v / s.spentMinor * 100} color={styleFor(c).color} label={t.categories[c] ?? c} />
      </View>) : <Text className="py-2 text-sm text-muted">{t.dashboard.empty}</Text>}
    </Card>
  </>;
}
