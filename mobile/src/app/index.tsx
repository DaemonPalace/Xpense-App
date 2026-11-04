import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, ErrorText } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api, ApiError, type Summary } from '@/lib/api';
import { formatCOP } from '@/lib/money';
import { t } from '@/strings';

export default function Home() {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Summary>('GET', '/api/summary');
      if (!r.consented) return router.replace('/consent');
      if (!r.onboarded) return router.replace('/onboarding');
      setS(r);
      setError('');
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setError(t.common.genericError);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const overToday = s ? s.safeToSpendTodayMinor < 0 : false;
  const banner = !s ? null : s.status === 'over' ? t.home.over(formatCOP(-s.remainingMinor)) : overToday ? t.home.overToday : s.status === 'warning' ? t.home.warning : null;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} hitSlop={12} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: Colors.accentText, fontSize: 16 }}>{t.home.settings}</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => (setRefreshing(true), await load(), setRefreshing(false))} />}>
        <ErrorText>{error}</ErrorText>
        {s && (
          <>
            {banner && (
              <View style={[styles.banner, s.status === 'over' && { borderLeftColor: Colors.danger }]} accessibilityRole="alert">
                <Text style={styles.bannerText}>{banner}</Text>
              </View>
            )}
            <View style={styles.card} accessible accessibilityLabel={`${t.home.safeToSpend}: ${formatCOP(s.safeToSpendTodayMinor)}`}>
              <Text style={styles.label}>{t.home.safeToSpend}</Text>
              <Text style={[styles.amount, overToday && { color: Colors.danger }]}>{formatCOP(s.safeToSpendTodayMinor)}</Text>
              <Text style={styles.label}>{t.home.dailyLimit(formatCOP(s.dailyLimitMinor))}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.text}>{t.home.remaining(formatCOP(Math.max(0, s.remainingMinor)), s.daysLeft)}</Text>
              <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.min(100, s.pctUsed) }}>
                <View style={[styles.fill, { width: `${Math.min(100, s.pctUsed)}%` }, s.pctUsed >= 100 && { backgroundColor: Colors.danger }]} />
              </View>
              <Text style={styles.label}>{t.home.used(s.pctUsed)}</Text>
              {s.savingsGoalMinor > 0 && <Text style={styles.label}>{t.home.goal(formatCOP(s.savedMinor), formatCOP(s.savingsGoalMinor))}</Text>}
            </View>
          </>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button label={`+ ${t.home.add}`} onPress={() => router.push('/add')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.three, gap: Spacing.three },
  card: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  label: { color: Colors.textSecondary, fontSize: 15 },
  text: { color: Colors.text, fontSize: 17 },
  amount: { color: Colors.text, fontSize: 40, fontWeight: '700' },
  banner: { backgroundColor: Colors.surface, borderLeftWidth: 6, borderLeftColor: Colors.greenYellow, borderRadius: 8, padding: Spacing.three },
  bannerText: { color: Colors.text, fontSize: 16 },
  track: { height: 10, borderRadius: 5, backgroundColor: Colors.background, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: Colors.lightGreen },
  footer: { padding: Spacing.three, paddingBottom: Spacing.five },
});
