import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { Button, colors, FormError, Loading, Page, type IconName } from '@/components/ui';
import { useAppData } from '@/data-context';

const icons = { hoy: 'home', gemelo: 'sparkles', comida: 'restaurant', movimientos: 'receipt' } as const;

export default function TabLayout() {
  const { summary, error, refresh } = useAppData();
  useFocusEffect(useCallback(() => void refresh(), [refresh]));
  if (!summary) return error ? <Page><FormError message={error} /><Button label="Reintentar" onPress={refresh} /></Page> : <Loading />;
  if (!summary.consented) return <Redirect href="/consent" />;
  if (!summary.onboarded) return <Redirect href="/onboarding" />;

  return <Tabs screenOptions={({ route }) => ({
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: colors.brand, tabBarInactiveTintColor: '#5B706D',
    tabBarLabelStyle: { fontSize: 12, fontFamily: 'PlusJakartaSans_600SemiBold' },
    tabBarStyle: { backgroundColor: '#FFFFFF', borderTopColor: colors.line, paddingTop: 6 },
    tabBarIcon: ({ color, size, focused }) => {
      const base = icons[route.name as keyof typeof icons];
      return <Ionicons name={(focused ? base : `${base}-outline`) as IconName} size={size} color={color as string} />;
    },
  })}>
    <Tabs.Screen name="hoy" options={{ title: 'Hoy' }} />
    <Tabs.Screen name="gemelo" options={{ title: 'Gemelo' }} />
    <Tabs.Screen name="comida" options={{ title: 'Comida' }} />
    <Tabs.Screen name="movimientos" options={{ title: 'Movimientos' }} />
  </Tabs>;
}
