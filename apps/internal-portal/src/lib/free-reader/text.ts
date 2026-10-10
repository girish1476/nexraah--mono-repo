/**
 * Gets the text out of a document, in the browser, at no cost.
 *
 * A PDF made on a computer carries its text, and that is read straight out of
 * it — exact, and instant. A photo or a scanned page has no text, so it is read
 * by Tesseract, an open-source character reader that runs here in the page.
 * Either way the file does not leave this computer.
 *
 * The two libraries are fetched the first time something is read, not shipped
 * with the console: together they are several megabytes that most visits never
 * need. Tesseract reads clear print well and handwriting poorly; what it cannot
 * make out simply is not found, and the person types it.
 */

const CDN = 'https://cdn.jsdelivr.net/npm';
const PDFJS = `${CDN}/pdfjs-dist@3.11.174/build`;
const TESSERACT = `${CDN}/tesseract.js@5.1.1/dist/tesseract.min.js`;

/** How much of a long file is read: details sit on the first pages. */
const MAX_PDF_PAGES = 6;
const MAX_SCANNED_PAGES = 3;
/** Fewer characters than this on a page means it is a picture of a page, not text. */
const TEXT_PAGE_MIN = 40;

export class ReaderUnavailable extends Error {}

const loading = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const already = loading.get(src);
  if (already) return already;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading.delete(src);
      script.remove();
      reject(new ReaderUnavailable(`Could not load ${src}`));
    };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

async function pdfjs(): Promise<any> {
  await loadScript(`${PDFJS}/pdf.min.js`);
  const lib = (window as any).pdfjsLib;
  if (!lib) throw new ReaderUnavailable('The PDF reader did not start.');
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
  return lib;
}

/** Reads a picture — a photo, or a page drawn to a canvas. */
async function readPicture(picture: Blob | HTMLCanvasElement): Promise<string> {
  await loadScript(TESSERACT);
  const Tesseract = (window as any).Tesseract;
  if (!Tesseract) throw new ReaderUnavailable('The text reader did not start.');
  let worker: any;
  try {
    worker = await Tesseract.createWorker('eng');
  } catch (e) {
    throw new ReaderUnavailable((e as Error)?.message ?? 'The text reader could not be loaded.');
  }
  try {
    const result = await worker.recognize(picture);
    return String(result?.data?.text ?? '');
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

async function readPdf(blob: Blob): Promise<string> {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages: string[] = [];
  let scanned = 0;
  for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = (content.items as any[]).map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`).join('');
    if (text.replace(/\s/g, '').length >= TEXT_PAGE_MIN) {
      pages.push(text);
      continue;
    }
    // A scanned page: drawn large enough for small print to be read, then read as a picture.
    if (scanned >= MAX_SCANNED_PAGES) continue;
    scanned += 1;
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pages.push(await readPicture(canvas));
  }
  return pages.join('\n');
}

/** The text of a PDF or a picture. Throws `ReaderUnavailable` when the reader could not be fetched. */
export async function documentText(blob: Blob, mime: string): Promise<string> {
  if (mime === 'application/pdf') return readPdf(blob);
  if (mime.startsWith('image/')) return readPicture(blob);
  throw new Error(`A ${mime || 'file of this kind'} cannot be read automatically.`);
}
