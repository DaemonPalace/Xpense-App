import '../../global.css';

import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Sheets, Toast } from '@/components/overlays';
import { DataProvider } from '@/data-context';
import { SessionProvider, useSession } from '@/session-context';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return <SafeAreaProvider><SessionProvider><DataProvider>
    <StatusBar style="dark" />
    <Nav />
  </DataProvider></SessionProvider></SafeAreaProvider>;
}

function Nav() {
  const { status } = useSession();
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
  });
  const ready = status !== 'loading' && (fontsLoaded || !!fontError);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null; // splash stays up until fonts and the stored session are read

  return <>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F3F8F7' } }}>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="consent" options={{ gestureEnabled: false }} />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="perfil" />
        <Stack.Screen name="cuentas" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="reset-password" />
      </Stack.Protected>
    </Stack>
    {status === 'signedIn' ? <><Sheets /><Toast /></> : null}
  </>;
}
