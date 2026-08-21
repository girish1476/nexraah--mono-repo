import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CameraFrame } from '@/components/camera-frame';
import { usePortalWebView } from '@/components/portal-webview-context';
import type { CaptureKind } from '@/lib/bridge-types';
import { uploadCapture } from '@/lib/upload';

const SCREEN_CONFIG: Record<CaptureKind, { facing: 'front' | 'back'; guide: 'card' | 'oval'; label: string }> = {
  KYC_PAN: { facing: 'back', guide: 'card', label: 'Line up the PAN card inside the frame' },
  KYC_AADHAAR: { facing: 'back', guide: 'card', label: 'Line up the Aadhaar card inside the frame' },
  SELFIE: { facing: 'front', guide: 'oval', label: 'Centre your face inside the frame' },
};

/**
 * The two native screens of part 09 §2.1 — one component, driven by the
 * `kind` route param. Native captures AND uploads (returns an
 * attachmentId, matching the bridge contract exactly) rather than
 * relaying a raw photo through the WebView bridge for the web side to
 * upload — a WebView JS context can't read a native file:// URI, so that
 * path would mean base64-encoding a multi-MB photo across the bridge, a
 * known jank/crash risk this avoids entirely.
 */
export default function CaptureScreen() {
  const { kind, vendorId } = useLocalSearchParams<{ kind: CaptureKind; vendorId: string }>();
  const { sendToWeb } = usePortalWebView();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = SCREEN_CONFIG[kind];
  if (!config) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Unknown capture kind: {kind}</Text>
      </View>
    );
  }

  const handleCapture = async (uri: string) => {
    setError(null);
    setBusy(true);
    try {
      let geo: { latitude: number; longitude: number } | undefined;
      if (kind === 'SELFIE') {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          // A refusal must be visible, never a silent success — matches the
          // web profile screen's own currentPosition() rule. No upload
          // without the geo-stamp for the selfie.
          setError('Location permission is required for the geo-stamped selfie.');
          setBusy(false);
          return;
        }
        const position = await Location.getCurrentPositionAsync({});
        geo = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      }

      const { attachmentId } = await uploadCapture(kind, uri, geo);
      sendToWeb({ type: 'capture.done', kind, attachmentId });
      router.back();
    } catch {
      setError('Upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraFrame
        facing={config.facing}
        guide={config.guide}
        label={config.label}
        busy={busy}
        onCapture={handleCapture}
      />
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <Pressable style={styles.closeButton} onPress={() => router.back()}>
        <Text style={styles.closeButtonText}>Cancel</Text>
      </Pressable>
      <Text style={styles.vendorTag}>{vendorId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  closeButton: { position: 'absolute', top: 56, left: 20, padding: 8 },
  closeButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  errorBanner: { position: 'absolute', bottom: 130, left: 20, right: 20, backgroundColor: '#9a3529', borderRadius: 8, padding: 12 },
  errorText: { color: '#fff', textAlign: 'center', fontSize: 13.5 },
  // Not rendered visibly — kept for a future "captured for VND-xxxx" confirmation label if needed.
  vendorTag: { position: 'absolute', opacity: 0, height: 0, width: 0 },
});
