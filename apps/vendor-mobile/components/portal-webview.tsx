import { router } from 'expo-router';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import type { CaptureRequestMessage } from '@/lib/bridge-types';
import { usePortalWebView } from './portal-webview-context';

const PORTAL_BASE_URL = process.env.EXPO_PUBLIC_PORTAL_BASE_URL ?? 'http://10.0.2.2:3001';

/**
 * Seeds the session and the native-capture shim before vendor-portal's own
 * JS runs — injectedJavaScriptBeforeContentLoaded, not injectedJavaScript,
 * so apis.ts's axios interceptor (which reads localStorage.token
 * unconditionally) and any page checking window.NexraahNative both see
 * them from their very first tick. The key must be the literal 'token' —
 * that's what apis.ts already reads. Never a token in the URL: this string
 * never touches source.uri or navigation history.
 */
function buildInjectedJs(sessionToken: string): string {
  return `
    window.localStorage.setItem('token', ${JSON.stringify(sessionToken)});
    window.NexraahNative = {
      capture: function (opts) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'capture.request', kind: opts.kind, vendorId: opts.vendorId,
        }));
      },
    };
    true;
  `;
}

export function PortalWebView({ sessionToken }: { sessionToken: string }) {
  const { webviewRef, activePath } = usePortalWebView();

  const handleMessage = (event: WebViewMessageEvent) => {
    let message: CaptureRequestMessage;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.type === 'capture.request') {
      router.push({ pathname: '/capture/[kind]', params: { kind: message.kind, vendorId: message.vendorId } });
    }
  };

  return (
    <WebView
      ref={webviewRef}
      source={{ uri: `${PORTAL_BASE_URL}${activePath}` }}
      injectedJavaScriptBeforeContentLoaded={buildInjectedJs(sessionToken)}
      onMessage={handleMessage}
      style={{ flex: 1 }}
    />
  );
}
