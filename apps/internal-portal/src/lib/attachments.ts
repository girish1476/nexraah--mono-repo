import { ApiError, request } from '@/apis';
import { integrationSwitches } from './integration-switches';

/**
 * Uploads a file through `/attachments` and returns its id — for the places that
 * attach evidence (an approval mail's screenshot) to something they are about to
 * record.
 */
/** One box of a verify form, as asked of the reader: its key, what it is called, and the kind of value it takes. */
export interface ReadField {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'number' | 'rupees';
  /**
   * For a text box that holds a known kind of number. The server checks what
   * it reads against that number's own rule — a PAN's shape, a GSTIN's check
   * digit — and leaves the box blank rather than fill it with one that fails.
   */
  format?:
    | 'pan'
    | 'aadhaarLast4'
    | 'gstin'
    | 'vehicle'
    | 'drivingLicence'
    | 'ifsc'
    | 'bankAccount'
    | 'ewayBill'
    | 'udyam'
    | 'phone'
    | 'pincode'
    | 'name';
}

/**
 * What a read answers with: `values` holds what could be read (dates as
 * YYYY-MM-DD, amounts in rupees, an Aadhaar number as its last four digits);
 * `unread` names the boxes left to type; `notes` is something to show beside a
 * box — "this date has already passed".
 */
export interface Reading {
  values: Record<string, string>;
  unread: string[];
  notes: Record<string, string>;
}

/**
 * POST /attachments/:id/read · `document.verify` — reads the named details off
 * a document already on file, for the "Fetch" button on a verify form.
 *
 * `docType` is the kind of paper (`DRIVING_LICENCE`, `EWAY_BILL`…), so the
 * reader is told where on it to look. It only suggests — nothing is saved.
 * 503 OCR_NOT_SET_UP when the server has no reader set up; 403 OCR_NOT_ALLOWED
 * for an identity paper where reading those has not been switched on.
 */
export async function readDocument(attachmentId: string, document: string, fields: ReadField[], docType?: string) {
  try {
    return await request<Reading>({
      url: `/attachments/${attachmentId}/read`,
      method: 'POST',
      data: { document, fields, ...(docType ? { docType } : {}) },
    });
  } catch (e) {
    if (!(await readHereInstead(e))) throw e;
    // The file on its signed address, read here.
    const { url, mime } = await request<{ url: string; mime?: string }>({ url: `/attachments/${attachmentId}/url`, method: 'GET' });
    const blob = await (await fetch(url)).blob();
    return readInBrowser(blob, mime || blob.type, fields, e);
  }
}

/**
 * Without the server's paid reader (no Anthropic key — the company runs on free
 * services), "Fetch" reads the file here in the browser instead: the PDF's own
 * text, or the open-source reader for a photo (`free-reader`). The same answer
 * comes back either way, so the screens cannot tell which read it.
 *
 * Only when the server says it has no reader (`503 OCR_NOT_SET_UP`) — never
 * when it refused for a reason that still holds here (an identity paper the
 * company has not allowed to be read, a file that is not a document) — and only
 * while the reader is switched on under Control → Integrations.
 */
async function readHereInstead(e: unknown): Promise<boolean> {
  if (!(e instanceof ApiError) || e.code !== 'OCR_NOT_SET_UP') return false;
  return (await integrationSwitches()).reader;
}

async function readInBrowser(blob: Blob, mime: string, fields: ReadField[], serverError: unknown): Promise<Reading> {
  const { readDetails, ReaderUnavailable } = await import('./free-reader');
  try {
    return await readDetails(blob, mime, fields);
  } catch (e) {
    if (e instanceof ReaderUnavailable) {
      throw new ApiError(503, 'OCR_NOT_SET_UP', 'The document reader could not be loaded — check the internet connection, or type the details in.');
    }
    if (e instanceof Error && /cannot be read automatically/.test(e.message)) {
      throw new ApiError(422, 'OCR_UNREADABLE', 'Only a PDF or a photo can be read automatically. Type the details in by hand.');
    }
    throw serverError;
  }
}

/**
 * POST /attachments/read — the same, for a file picked but not yet uploaded,
 * so its number can be filled in beside the file picker. The file is read and
 * not kept; uploading it is still its own step.
 */
export async function readFile(file: File, document: string, fields: ReadField[], docType?: string) {
  const form = new FormData();
  form.append('file', file);
  form.append('request', JSON.stringify({ document, fields, ...(docType ? { docType } : {}) }));
  try {
    return await request<Reading>({ url: '/attachments/read', method: 'POST', data: form });
  } catch (e) {
    if (!(await readHereInstead(e))) throw e;
    return readInBrowser(file, file.type, fields, e);
  }
}

export async function uploadAttachment(file: File, kind: string, entityType: string, entityId: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  const uploaded = await request<{ id: string }>({ url: '/attachments', method: 'POST', data: form });
  return uploaded.id;
}

/**
 * Opens an uploaded file in a new tab.
 *
 * A browser will not open a `data:` address in a new tab — it shows a blank
 * page instead — and that is how a file kept in this browser is handed back.
 * So a `data:` address is turned into a blob of the same bytes first, which a
 * new tab opens normally. An ordinary address (a signed link from the real
 * server) is opened as it is.
 */
export async function openFileInNewTab(url: string): Promise<void> {
  if (!url.startsWith('data:')) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const blob = await (await fetch(url)).blob();
  const address = URL.createObjectURL(blob);
  window.open(address, '_blank', 'noopener,noreferrer');
  // The new tab has the file by now; let the browser forget the address.
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}
