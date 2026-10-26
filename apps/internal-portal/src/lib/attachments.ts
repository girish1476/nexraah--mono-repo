import { ApiError, request } from '@/apis';

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
    if (!noServerReader(e)) throw e;
    const { url } = await request<{ url: string }>({ url: `/attachments/${attachmentId}/url`, method: 'GET' });
    const file = await (await fetch(url)).blob();
    return (await import('./local-ocr')).readLocally(file, fields);
  }
}

/**
 * Where the server has no reader set up — and in the fixtures, which have no
 * server — the file is read in the browser instead (`local-ocr.ts`). Only
 * then: a server that has a reader and declines to use it (403
 * OCR_NOT_ALLOWED) has said no, and is not gone round.
 */
const noServerReader = (e: unknown) => e instanceof ApiError && e.code === 'OCR_NOT_SET_UP';

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
    if (!noServerReader(e)) throw e;
    return (await import('./local-ocr')).readLocally(file, fields);
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
