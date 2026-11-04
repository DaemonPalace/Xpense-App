import { Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { t } from '@/strings';

export default function Home() {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: t.appName }} />
      <View style={styles.card} accessible accessibilityLabel={`${t.home.safeToSpend}: pendiente`}>
        <Text style={styles.label}>{t.home.safeToSpend}</Text>
        <Text style={styles.amount}>—</Text>
      </View>
      <Text style={styles.hint}>{t.home.comingSoon}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  card: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 6,
    borderLeftColor: Colors.greenYellow,
    borderRadius: 12,
    padding: Spacing.four,
  },
  label: { color: Colors.textSecondary, fontSize: 16 },
  amount: { color: Colors.text, fontSize: 40, fontWeight: '700' },
  hint: { color: Colors.textSecondary, fontSize: 15 },
});
