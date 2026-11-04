import { StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';

/** Horizontal bar, 0–100%. Optional marker line (e.g. the ideal pace). */
export function Bar({ pct, marker, color = Colors.lightGreen }: { pct: number; marker?: number; color?: string }) {
  const clamp = (n: number) => `${Math.max(0, Math.min(100, n))}%` as const;
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.min(100, pct)) }}>
      <View style={[styles.fill, { width: clamp(pct), backgroundColor: color }]} />
      {marker !== undefined && <View style={[styles.marker, { left: clamp(marker) }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 12, borderRadius: 6, backgroundColor: Colors.background, overflow: 'hidden' },
  fill: { height: '100%' },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: Colors.text },
});
