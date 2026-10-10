/**
 * The files uploaded while the console runs on fixtures — kept so a document
 * that was uploaded can be shown again, the way the real API serves it back
 * from storage on a signed URL.
 *
 * Photos are shrunk to a JPEG no wider than 1400px before they are kept, so a
 * phone photo of a lorry receipt costs a few hundred KB, not five MB. Nothing
 * leaves the browser.
 *
 * They are kept in the browser's database (IndexedDB), which has room for
 * hundreds of megabytes. They used to be kept in `localStorage` beside the
 * console's records, and that is a five-megabyte box for both together: a
 * dozen document photos filled it, and from then on the records themselves
 * could not be saved — silently. A load raised after that existed only until
 * the page was next reloaded, and then "Indent i-6 not found". Files left in
 * the old place are moved across the first time this runs, which gives the
 * records their room back.
 *
 * A seeded document has no file behind it; it is shown as a drawn sample page
 * with its name on it, never a broken image.
 */

/** Where files used to be kept, beside the records. Emptied once its files are moved. */
const LEGACY_KEY = 'nexraah.mockfiles.v1';
const DB_NAME = 'nexraah-files';
const STORE = 'files';
const MAX_IMAGE_EDGE = 1400;
/** A file bigger than this (a long scanned PDF) is held for the session only. */
const MAX_KEPT_BYTES = 12_000_000;

export interface KeptFile {
  url: string;
  mime: string;
  name: string;
}

/** Every kept file, by attachment id. Filled from the browser's database as the console starts. */
const memory = new Map<string, KeptFile>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      // Private browsing, or a browser that refuses: files last for the session only.
      resolve(null);
    }
  });
}

const database: Promise<IDBDatabase | null> = typeof window === 'undefined' ? Promise.resolve(null) : openDb();

function put(db: IDBDatabase, id: string, file: KeptFile): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(file, id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function readAll(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        memory.set(String(cursor.key), cursor.value as KeptFile);
        cursor.continue();
      };
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Moves files out of the records' storage into the database, and frees that storage. */
async function moveLegacy(db: IDBDatabase | null): Promise<void> {
  let legacy: Record<string, KeptFile> = {};
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    legacy = JSON.parse(raw) as Record<string, KeptFile>;
  } catch {
    return;
  }
  let allMoved = true;
  for (const [id, file] of Object.entries(legacy)) {
    if (!memory.has(id)) memory.set(id, file);
    if (!db || !(await put(db, id, file))) allMoved = false;
  }
  // The old copy goes even when a file could not be moved: it stays shown for
  // this session, and the records getting saved again matters more than a
  // document photo that can be uploaded again.
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // nothing to do
  }
  void allMoved;
}

/**
 * Resolves once the kept files are loaded and any left in the old place have
 * been moved. The adapter waits for it before answering its first request, so
 * a document is never shown as a sample page only because it was asked for a
 * moment too early.
 */
export const filesReady: Promise<void> =
  typeof window === 'undefined'
    ? Promise.resolve()
    : database
        .then(async (db) => {
          if (db) await readAll(db);
          await moveLegacy(db);
        })
        .catch(() => undefined);

function store(id: string, file: KeptFile) {
  memory.set(id, file);
  void database.then((db) => (db ? put(db, id, file) : false));
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
    if (blob.size <= MAX_KEPT_BYTES) {
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
  const kept = memory.get(id);
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
