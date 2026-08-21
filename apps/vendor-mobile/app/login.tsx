import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { saveSession } from '@/lib/secure-session';

/**
 * DEV-MODE PLACEHOLDER. There is no real vendor auth backend yet —
 * vendor-api has no auth module, and internal-api's auth module explicitly
 * rejects transporter tokens (see the mobile-shell plan). This screen
 * exercises the real secure-store → WebView-localStorage-injection
 * pipeline end to end; only its contents change once vendor-api ships
 * real transporter auth (P1 of the vendor-specs track) — the plumbing
 * downstream of saveSession() does not.
 */
export default function LoginScreen() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const continueWith = async (value: string) => {
    setBusy(true);
    try {
      await saveSession(value);
      router.replace('/main');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.banner}>DEV MODE — no real vendor login exists yet.</Text>
      <Text style={styles.title}>Nexraah — Vendor</Text>
      <TextInput
        style={styles.input}
        placeholder="Paste any token (mock mode ignores its value)"
        placeholderTextColor="#8a94a6"
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        disabled={busy}
        onPress={() => continueWith(token || 'DEV-TOKEN')}
      >
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
      <Pressable
        style={[styles.button, styles.buttonSecondary, busy && styles.buttonDisabled]}
        disabled={busy}
        onPress={() => continueWith('DEV-NO-AUTH-TOKEN')}
      >
        <Text style={styles.buttonSecondaryText}>Continue without login (dev)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#fff' },
  banner: { color: '#9a3529', fontSize: 12.5, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 20, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#c6d0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginBottom: 8,
  },
  button: { backgroundColor: '#173a75', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#c6d0e0' },
  buttonSecondaryText: { color: '#173a75', fontWeight: '600', fontSize: 15 },
});
