import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Bar } from '@/components/bar';
import { Body, ErrorText, Screen } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api, type Summary } from '@/lib/api';
import { formatCOP } from '@/lib/money';
import { t } from '@/strings';

export default function Dashboard() {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      api<Summary>('GET', '/api/summary').then(setS, () => setError(t.common.genericError));
    }, []),
  );

  if (!s) return <Screen><ErrorText>{error}</ErrorText></Screen>;

  const categories = Object.entries(s.byCategoryMinor).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = categories[0]?.[1] ?? 1;
  const daysInMonth = s.dailyMinor.length;
  const today = Number(s.today.slice(8, 10));
  const weeks: { n: number; spent: number; pace: number }[] = [];
  for (let end = 7, n = 1, acc = 0, day = 0; day < daysInMonth && day < today; end += 7, n++) {
    for (; day < Math.min(end, daysInMonth); day++) acc += s.dailyMinor[day];
    weeks.push({ n, spent: acc, pace: Math.round((s.allowedMinor * Math.min(end, daysInMonth)) / daysInMonth) });
  }
  const goalPct = s.savingsGoalMinor > 0 ? Math.round((s.savedMinor * 100) / s.savingsGoalMinor) : 0;
  const scale = Math.max(s.allowedMinor, ...weeks.map((w) => w.spent), 1);

  return (
    <Screen>
      <Section title={t.dashboard.byCategory}>
        {!categories.length && <Body muted>{t.dashboard.empty}</Body>}
        {categories.map(([c, v]) => (
          <Pressable key={c} accessibilityRole="link" onPress={() => router.push({ pathname: '/movements', params: { category: c } })} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>{t.categories[c] ?? c}</Text>
              <Text style={styles.value}>{formatCOP(v)}</Text>
            </View>
            <Bar pct={(v * 100) / max} />
          </Pressable>
        ))}
      </Section>

      <Section title={t.dashboard.weekly}>
        {weeks.map((w) => (
          <View key={w.n} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>{t.dashboard.week(w.n)}</Text>
              <Text style={styles.value}>{t.dashboard.pace(formatCOP(w.spent), formatCOP(w.pace))}</Text>
            </View>
            <Bar pct={(w.spent * 100) / scale} marker={(w.pace * 100) / scale} color={w.spent > w.pace ? Colors.danger : Colors.lightGreen} />
          </View>
        ))}
      </Section>

      <Section title={t.dashboard.goal}>
        <Text style={styles.value}>{t.dashboard.goalProgress(formatCOP(s.savedMinor), formatCOP(s.savingsGoalMinor), goalPct)}</Text>
        <Bar pct={goalPct} color={Colors.greenYellow} />
        <Body muted>{t.dashboard.vault(formatCOP(s.vaultBalanceMinor))}</Body>
      </Section>

      <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/movements', params: { ant: '1' } })}>
        <Section title={t.dashboard.ant}>
          <Body>{s.ant.count ? t.dashboard.antSummary(s.ant.count, formatCOP(s.ant.totalMinor)) : t.dashboard.antNone}</Body>
        </Section>
      </Pressable>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  row: { gap: Spacing.one, minHeight: 44, justifyContent: 'center' },
  rowText: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  label: { fontSize: 15, color: Colors.text },
  value: { fontSize: 15, color: Colors.textSecondary },
});
