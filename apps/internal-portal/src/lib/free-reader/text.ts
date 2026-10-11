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

/**
 * Reads a picture — a photo, or a page drawn to a canvas. `quarterTurns` turns
 * it first: a card photographed sideways reads as noise the right way up.
 */
export type ReadPicture = (picture: Blob | HTMLCanvasElement, quarterTurns?: number) => Promise<string>;

/**
 * Starts the picture reader, hands it to `work`, and shuts it when `work` is
 * done — so several pages, or one photo tried at each quarter turn, share the
 * one start-up instead of paying for it each time.
 */
export async function withPictureReader<T>(work: (read: ReadPicture) => Promise<T>): Promise<T> {
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
    return await work(async (picture, quarterTurns = 0) => {
      const result = await worker.recognize(quarterTurns % 4 ? await turned(picture, quarterTurns) : picture);
      return String(result?.data?.text ?? '');
    });
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

/**
 * The picture turned by quarter turns, clockwise. Drawn here rather than left to
 * the reader's own rotation: a quarter turn on a canvas moves every dot to a
 * whole place and loses nothing, where the reader's turning blurs the print
 * enough to change a 9 into a 3.
 */
async function turned(picture: Blob | HTMLCanvasElement, quarterTurns: number): Promise<HTMLCanvasElement> {
  const source: CanvasImageSource & { width: number; height: number } =
    picture instanceof Blob ? await createImageBitmap(picture) : picture;
  const turns = ((quarterTurns % 4) + 4) % 4;
  const canvas = document.createElement('canvas');
  const sideways = turns % 2 === 1;
  canvas.width = sideways ? source.height : source.width;
  canvas.height = sideways ? source.width : source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

async function readPdf(blob: Blob): Promise<string> {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages: string[] = [];
  const scanned: { at: number; canvas: HTMLCanvasElement }[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = (content.items as any[]).map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`).join('');
    if (text.replace(/\s/g, '').length >= TEXT_PAGE_MIN) {
      pages.push(text);
      continue;
    }
    // A scanned page: drawn large enough for small print to be read, then read as a picture.
    pages.push('');
    if (scanned.length >= MAX_SCANNED_PAGES) continue;
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    scanned.push({ at: pages.length - 1, canvas });
  }
  if (scanned.length > 0) {
    await withPictureReader(async (read) => {
      for (const page of scanned) pages[page.at] = await read(page.canvas);
    });
  }
  return pages.filter(Boolean).join('\n');
}

/** The text of a PDF. Throws `ReaderUnavailable` when the reader could not be fetched. */
export async function pdfText(blob: Blob): Promise<string> {
  return readPdf(blob);
}
