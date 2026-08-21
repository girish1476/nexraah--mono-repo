import { getSession } from './secure-session';
import type { CaptureKind } from './bridge-types';

const USE_MOCK = process.env.EXPO_PUBLIC_MOCK === '1';

/**
 * Posts to the same endpoint shape apps/vendor-portal/src/app/profile/apis.ts's
 * uploadDocument() already uses — POST /portal/profile/documents/:kind,
 * multipart, latitude/longitude for the selfie. No real vendor-api endpoint
 * exists yet (no auth module, no portal module — see the plan), so this
 * mocks until it does; the shape below is what a real implementation must
 * match.
 */
export async function uploadCapture(
  kind: CaptureKind,
  uri: string,
  geo?: { latitude: number; longitude: number },
): Promise<{ attachmentId: string }> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 500));
    return { attachmentId: `mock-${kind}-${Date.now()}` };
  }

  const form = new FormData();
  // React Native's fetch/FormData accepts a { uri, name, type } file object
  // directly — no base64 encoding needed, unlike relaying the photo through
  // the WebView bridge would require.
  form.append('file', { uri, name: `${kind}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  if (geo) {
    form.append('latitude', String(geo.latitude));
    form.append('longitude', String(geo.longitude));
  }

  const token = await getSession();
  const res = await fetch(`${process.env.EXPO_PUBLIC_API_BASE_URL}/portal/profile/documents/${kind}`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const body = await res.json();
  return { attachmentId: body.data.attachmentId };
}
