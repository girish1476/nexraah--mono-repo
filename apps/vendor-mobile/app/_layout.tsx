import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { PortalWebViewProvider } from '@/components/portal-webview-context';
import { useColorScheme } from '@/components/useColorScheme';
import { getSession } from '@/lib/secure-session';

SplashScreen.preventAutoHideAsync();

/**
 * All three screens are always registered — Expo Router navigators are
 * meant to declare their full screen set up front, not have entries
 * appear/disappear as state changes. Routing between them (below) is a
 * router.replace() effect, not conditional Stack.Screen inclusion.
 */
export default function RootLayout() {
  const colorScheme = useColorScheme();
  // undefined = still checking secure storage.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    getSession().then((session) => {
      router.replace(session ? '/main' : '/login');
      setChecked(true);
    });
  }, []);

  useEffect(() => {
    if (checked) SplashScreen.hideAsync();
  }, [checked]);

  if (!checked) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <PortalWebViewProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="login" />
          <Stack.Screen name="main" />
          <Stack.Screen name="capture" options={{ presentation: 'fullScreenModal' }} />
        </Stack>
      </PortalWebViewProvider>
    </ThemeProvider>
  );
}
