import { createContext, ReactNode, useContext, useRef, useState } from 'react';
import type WebView from 'react-native-webview';
import type { NativeToWebMessage } from '@/lib/bridge-types';

interface PortalWebViewContextValue {
  webviewRef: React.RefObject<WebView>;
  activePath: string;
  setActivePath: (path: string) => void;
  sendToWeb: (message: NativeToWebMessage) => void;
}

const PortalWebViewContext = createContext<PortalWebViewContextValue | null>(null);

/**
 * One native WebView, shared by every tab and by the capture screens.
 * React Navigation keeps backgrounded tabs mounted by default — four
 * independent WebView instances would mean four live native views
 * resident at once on a device that's realistically low-to-mid-range
 * Android, for no benefit (vendor-portal's tabs are server-rendered pages
 * with no client state worth preserving across a switch). The four
 * (tabs)/*.tsx route files only call setActivePath(); this component is
 * what actually renders the single <WebView>.
 */
export function PortalWebViewProvider({ children }: { children: ReactNode }) {
  const webviewRef = useRef<WebView>(null);
  const [activePath, setActivePath] = useState('/loads');

  const sendToWeb = (message: NativeToWebMessage) => {
    webviewRef.current?.postMessage(JSON.stringify(message));
  };

  return (
    <PortalWebViewContext.Provider value={{ webviewRef, activePath, setActivePath, sendToWeb }}>
      {children}
    </PortalWebViewContext.Provider>
  );
}

export function usePortalWebView(): PortalWebViewContextValue {
  const ctx = useContext(PortalWebViewContext);
  if (!ctx) throw new Error('usePortalWebView must be used within PortalWebViewProvider');
  return ctx;
}
