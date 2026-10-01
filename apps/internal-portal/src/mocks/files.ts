/**
 * The files uploaded while the console runs on fixtures — kept so a document
 * that was uploaded can be shown again, the way the real API serves it back
 * from storage on a signed URL.
 *
 * Photos are shrunk to a JPEG no wider than 1400px before they are kept, so a
 * phone photo of a lorry receipt costs a few hundred KB, not five MB. Kept in
 * this browser's storage when there is room, and in memory for the session
 * when there is not (a large PDF). Nothing leaves the browser.
 *
 * A seeded document has no file behind it; it is shown as a drawn sample page
 * with its name on it, never a broken image.
 */

const STORE_KEY = 'nexraah.mockfiles.v1';
const MAX_IMAGE_EDGE = 1400;
const MAX_STORED_CHARS = 1_800_000;

export interface KeptFile {
  url: string;
  mime: string;
  name: string;
}

const memory = new Map<string, KeptFile>();

function stored(): Record<string, KeptFile> {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORE_KEY) : null;
    return raw ? (JSON.parse(raw) as Record<string, KeptFile>) : {};
  } catch {
    return {};
  }
}

function store(id: string, file: KeptFile) {
  memory.set(id, file);
  if (file.url.length > MAX_STORED_CHARS) return;
  try {
    const all = stored();
    all[id] = file;
    window.localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // Out of room: it stays in memory for this session.
  }
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function shrinkImage(blob: Blob): Promise<string> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return readAsDataUrl(blob);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return readAsDataUrl(blob);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** Keeps an uploaded file under its attachment id. Never throws — a file that cannot be kept just shows as a sample. */
export async function keepFile(id: string, blob: Blob & { name?: string }): Promise<void> {
  const name = blob.name ?? 'upload';
  const mime = blob.type || 'application/octet-stream';
  try {
    if (mime.startsWith('image/')) {
      store(id, { url: await shrinkImage(blob), mime: 'image/jpeg', name });
      return;
    }
    if (blob.size <= MAX_STORED_CHARS * 0.7) {
      store(id, { url: await readAsDataUrl(blob), mime, name });
      return;
    }
    memory.set(id, { url: URL.createObjectURL(blob), mime, name });
  } catch {
    // jsdom or a browser without canvas: leave it to the sample page.
  }
}

/** The kept file, or a drawn sample page for a document seeded without one. */
export function fileFor(id: string): KeptFile {
  const kept = memory.get(id) ?? stored()[id];
  if (kept) return kept;
  return { url: samplePage(id), mime: 'image/svg+xml', name: `${id}.svg` };
}

function samplePage(id: string): string {
  const label = id
    .replace(/^att-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 34);
  const lines = Array.from({ length: 9 }, (_, i) => {
    const y = 128 + i * 26;
    const w = [300, 260, 320, 210, 290, 240, 310, 180, 270][i];
    return `<rect x="40" y="${y}" width="${w}" height="9" rx="4" fill="#d9dee7"/>`;
  }).join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560">` +
    `<rect width="420" height="560" fill="#ffffff"/><rect x="0.5" y="0.5" width="419" height="559" fill="none" stroke="#c7ceda"/>` +
    `<rect x="40" y="40" width="340" height="52" rx="6" fill="#eef1f5"/>` +
    `<text x="56" y="72" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#16213a">${escapeXml(label)}</text>` +
    lines +
    `<rect x="250" y="440" width="130" height="70" rx="8" fill="none" stroke="#1c6e61" stroke-width="2" stroke-dasharray="6 4"/>` +
    `<text x="315" y="481" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="#1c6e61">Sample copy</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);
}
