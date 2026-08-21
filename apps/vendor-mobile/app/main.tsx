import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomTabBar } from '@/components/bottom-tab-bar';
import { PortalWebView } from '@/components/portal-webview';
import { usePortalWebView } from '@/components/portal-webview-context';
import { getSession } from '@/lib/secure-session';

/**
 * The whole "app" behind the tab bar: one WebView (portal-webview.tsx),
 * navigated in place by the custom BottomTabBar rather than by Expo
 * Router — see bottom-tab-bar.tsx for why. capture/[kind].tsx overlays
 * this screen as a full-screen modal when the web side requests a native
 * capture; this screen stays mounted underneath, so the WebView (and its
 * ref in PortalWebViewProvider) survives the round trip untouched.
 */
export default function MainScreen() {
  const { activePath, setActivePath } = usePortalWebView();
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  useEffect(() => {
    getSession().then(setSessionToken);
  }, []);

  if (!sessionToken) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      <PortalWebView sessionToken={sessionToken} />
      <BottomTabBar activePath={activePath} onSelect={setActivePath} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
