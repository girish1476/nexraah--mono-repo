import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Shared capture UI for both native screens (part 09 §2.1) — a KYC card
 * photo (back camera, rectangular guide) or the geo-stamped selfie (front
 * camera, oval guide). The two only ever differed by `facing` and the
 * guide shape, so one component covers both rather than duplicating the
 * permission/shutter/busy-state plumbing twice.
 */
export function CameraFrame({
  facing,
  guide,
  label,
  busy,
  onCapture,
}: {
  facing: CameraType;
  guide: 'card' | 'oval';
  label: string;
  busy: boolean;
  onCapture: (uri: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);

  if (!permission) return <View style={styles.center} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Camera access is needed to capture this photo.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </Pressable>
      </View>
    );
  }

  const capture = async () => {
    if (capturing || busy) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) onCapture(photo.uri);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />
      <View pointerEvents="none" style={[styles.guide, guide === 'oval' ? styles.oval : styles.card]} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.controls}>
        <Pressable
          style={[styles.shutter, (capturing || busy) && styles.shutterDisabled]}
          disabled={capturing || busy}
          onPress={capture}
        >
          {capturing || busy ? <ActivityIndicator color="#fff" /> : <View style={styles.shutterInner} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  permissionText: { color: '#fff', textAlign: 'center', fontSize: 15 },
  button: { backgroundColor: '#173a75', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
  guide: { position: 'absolute', borderWidth: 2, borderColor: '#fff' },
  card: { top: '30%', left: '8%', right: '8%', height: '28%', borderRadius: 10 },
  oval: { top: '20%', left: '20%', right: '20%', height: '45%', borderRadius: 999 },
  label: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  controls: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisabled: { opacity: 0.6 },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
});
