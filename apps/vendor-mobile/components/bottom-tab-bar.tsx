import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * A plain, custom tab bar rather than Expo Router's file-based <Tabs> —
 * deliberate. <Tabs> gives each tab its own screen/route, and React
 * Navigation keeps backgrounded tab screens mounted by default; four tabs
 * each hosting their own <WebView> would mean four live native views
 * resident at once. These "tabs" are really just four vendor-portal paths
 * loaded into the one shared WebView (portal-webview-context.tsx), so a
 * tab press only needs to change which path that WebView points at — no
 * navigation, no screen mount/unmount, and so no reload flash.
 */
const TABS: { path: string; label: string }[] = [
  { path: '/loads', label: 'Loads' },
  { path: '/quotes', label: 'Quotes' },
  { path: '/trips', label: 'Trips' },
  { path: '/fleet', label: 'Fleet' },
];

export function BottomTabBar({ activePath, onSelect }: { activePath: string; onSelect: (path: string) => void }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map((tab) => {
        const active = activePath === tab.path;
        return (
          <Pressable key={tab.path} style={styles.tab} onPress={() => onSelect(tab.path)}>
            <View style={[styles.dot, active && styles.dotActive]} />
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#c6d0e0',
    backgroundColor: '#fff',
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'transparent' },
  dotActive: { backgroundColor: '#173a75' },
  label: { fontSize: 12, color: '#48566b' },
  labelActive: { color: '#173a75', fontWeight: '600' },
});
