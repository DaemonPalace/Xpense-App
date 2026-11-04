import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';
import { SessionProvider, useSession } from '@/session-context';
import { t } from '@/strings';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Nav />
    </SessionProvider>
  );
}

function Nav() {
  const { status } = useSession();
  if (status === 'loading') return null; // splash stays up until the stored session is read

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Colors.background },
      }}>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="index" options={{ title: t.appName }} />
        <Stack.Screen name="consent" options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="onboarding" options={{ title: t.onboarding.title, headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="add" options={{ title: t.add.title, presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ title: t.settings.title }} />
        <Stack.Screen name="dashboard" options={{ title: t.dashboard.title }} />
        <Stack.Screen name="movements" options={{ title: t.movements.title }} />
        <Stack.Screen name="accounts" options={{ title: t.accounts.title }} />
        <Stack.Screen name="vault" options={{ title: t.vault.title }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="sign-in" options={{ title: t.appName }} />
        <Stack.Screen name="sign-up" options={{ title: t.auth.signUpTitle }} />
        <Stack.Screen name="reset-password" options={{ title: t.auth.resetTitle }} />
      </Stack.Protected>
    </Stack>
  );
}
