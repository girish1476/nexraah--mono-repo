import * as SecureStore from 'expo-secure-store';

/**
 * The one place a session token is read or written natively. Separate from
 * the key `apis.ts` reads inside the WebView's `localStorage` (always the
 * literal string `'token'`, injected fresh on every WebView load) — this
 * key is only how the native shell remembers the session between app
 * launches.
 */
const SESSION_KEY = 'nexraah_vendor_session';

export function getSession(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY);
}

export function saveSession(token: string): Promise<void> {
  return SecureStore.setItemAsync(SESSION_KEY, token);
}

export function clearSession(): Promise<void> {
  return SecureStore.deleteItemAsync(SESSION_KEY);
}
