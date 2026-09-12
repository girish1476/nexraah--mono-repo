/**
 * The web half of the web↔native contract, mirroring
 * `apps/vendor-mobile/lib/bridge-types.ts` (mobile-shell spec part 09 §2.3).
 *
 * That file has always claimed this one existed; it did not. Keeping the two
 * in sync is still by hand — there is no shared package, per the README's
 * rule that `packages/*` waits for a second *runtime* consumer, and this is
 * types plus a few lines of guard.
 *
 * Everything here degrades to a no-op in a plain browser. The portal is a
 * normal website first and the app's WebView second, so nothing may assume
 * the native side is present.
 */

export type CaptureKind = 'KYC_PAN' | 'KYC_AADHAAR' | 'SELFIE';

export interface CaptureRequestMessage {
  type: 'capture.request';
  kind: CaptureKind;
  vendorId: string;
}

/** Sent when the app should print a document the web side has composed. */
export interface PrintRequestMessage {
  type: 'print.request';
  /** A complete, standalone HTML document — `expo-print` renders it alone. */
  html: string;
  /** Names the file if the transporter chooses "Save as PDF". */
  title: string;
}

export interface CaptureDoneMessage {
  type: 'capture.done';
  kind: CaptureKind;
  attachmentId: string;
}

/** The app's answer to a `print.request`. */
export interface PrintDoneMessage {
  type: 'print.done';
  ok: boolean;
  message?: string;
}

export type WebToNativeMessage = CaptureRequestMessage | PrintRequestMessage;
export type NativeToWebMessage = CaptureDoneMessage | PrintDoneMessage;

interface NexraahNative {
  capture?: (opts: { kind: CaptureKind; vendorId: string }) => void;
  print?: (opts: { html: string; title: string }) => void;
}

function native(): NexraahNative | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as { NexraahNative?: NexraahNative }).NexraahNative;
}

/**
 * Whether this page is running inside the vendor app's WebView.
 *
 * Keyed on `ReactNativeWebView` rather than on `NexraahNative`, because the
 * two answer different questions: the first is "am I in the app", the second
 * is "does this build of the app support the thing I want". An older app
 * shell that predates a capability is still the app, and telling someone to
 * "open this in a browser" is the right answer there — telling them nothing
 * is not.
 */
export function isInVendorApp(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { ReactNativeWebView?: unknown }).ReactNativeWebView);
}

/**
 * Asks the app to print a document. Returns false when the running app
 * cannot — an older shell without the print bridge, or a plain browser — so
 * the caller can say something true rather than appear to have worked.
 */
export function nativePrint(html: string, title: string): boolean {
  const bridge = native();
  if (!bridge?.print) return false;
  try {
    bridge.print({ html, title });
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribes to the app's reply to a print request. Returns an unsubscribe.
 *
 * Listens on both `window` and `document` because `react-native-webview`
 * delivers to different targets by platform — Android dispatches on
 * `document`, iOS on `window`. Registering on one only works on one.
 */
export function onNativePrintResult(handler: (result: PrintDoneMessage) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: Event) => {
    const data = (event as MessageEvent).data;
    if (typeof data !== 'string') return;
    try {
      const parsed = JSON.parse(data) as NativeToWebMessage;
      if (parsed?.type === 'print.done') handler(parsed);
    } catch {
      // Not ours. The WebView carries other traffic and this must ignore it
      // rather than throw inside an event listener.
    }
  };

  window.addEventListener('message', listener);
  document.addEventListener('message', listener as EventListener);
  return () => {
    window.removeEventListener('message', listener);
    document.removeEventListener('message', listener as EventListener);
  };
}
