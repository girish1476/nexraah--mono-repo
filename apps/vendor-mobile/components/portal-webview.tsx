import { router } from 'expo-router';
import * as Print from 'expo-print';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import type { WebToNativeMessage } from '@/lib/bridge-types';
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
      // Android's WebView has no window.print(), so the printable page hands
      // its HTML over and the native side prints it. The web side checks for
      // this function before offering the button, so an older shell without
      // it says "open in your browser" rather than failing silently.
      print: function (opts) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'print.request', html: opts.html, title: opts.title,
        }));
      },
    };
    true;
  `;
}

export function PortalWebView({ sessionToken }: { sessionToken: string }) {
  const { webviewRef, activePath, sendToWeb } = usePortalWebView();

  const handleMessage = (event: WebViewMessageEvent) => {
    let message: WebToNativeMessage;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.type === 'capture.request') {
      router.push({ pathname: '/capture/[kind]', params: { kind: message.kind, vendorId: message.vendorId } });
      return;
    }
    if (message.type === 'print.request') {
      void handlePrint(message.html, message.title);
    }
  };

  /**
   * Opens the OS print sheet, which on both platforms offers real printers
   * and "Save as PDF" — the same two choices the browser gives, so the app
   * is not a lesser path for a document a driver may need on paper at a
   * checkpost.
   *
   * A dismissed sheet is not a failure. `expo-print` rejects when the user
   * cancels on iOS, and reporting that as an error would tell someone their
   * receipt failed to print when they simply changed their mind.
   */
  const handlePrint = async (html: string, title: string) => {
    try {
      await Print.printAsync({ html });
      sendToWeb({ type: 'print.done', ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/cancel|dismiss/i.test(message)) {
        sendToWeb({ type: 'print.done', ok: true });
        return;
      }
      sendToWeb({
        type: 'print.done',
        ok: false,
        message: `${title} could not be printed. Try again, or open the page in your browser.`,
      });
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
