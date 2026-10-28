import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Fetch" against the real server with no paid reader (27 Oct 2026): the
 * server says `503 OCR_NOT_SET_UP`, and the file is read in the browser instead.
 * The server and the in-browser reader are stood in, so only the choice
 * between them is tested here.
 */

const request = vi.fn();
const readDetails = vi.fn();
let switches = { reader: true };

vi.mock('@/apis', async () => {
  const real = await vi.importActual<typeof import('@/apis')>('@/apis');
  return { ...real, request: (...args: unknown[]) => request(...args) };
});
vi.mock('./integration-switches', () => ({ integrationSwitches: async () => switches }));
vi.mock('./free-reader', () => ({
  readDetails: (...args: unknown[]) => readDetails(...args),
  ReaderUnavailable: class ReaderUnavailable extends Error {},
}));

const { ApiError } = await import('@/apis');
const { readDocument, readFile } = await import('./attachments');

const FIELDS = [{ key: 'reference', label: 'PAN number', format: 'pan' as const }];
const READ = { values: { reference: 'AAKCN9322K' }, unread: [], notes: {} };
const noReader = () => new ApiError(503, 'OCR_NOT_SET_UP', 'Reading documents is not set up yet.');

beforeEach(() => {
  request.mockReset();
  readDetails.mockReset();
  switches = { reader: true };
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }) })));
});

describe('Fetch with no reader on the server', () => {
  it('a picked file is read in the browser', async () => {
    request.mockRejectedValueOnce(noReader());
    readDetails.mockResolvedValueOnce(READ);
    const file = new File(['x'], 'pan.jpg', { type: 'image/jpeg' });
    expect(await readFile(file, 'PAN card', FIELDS)).toEqual(READ);
    expect(readDetails).toHaveBeenCalledWith(file, 'image/jpeg', FIELDS);
  });

  it('a document on file is fetched through its signed address and read in the browser', async () => {
    request.mockRejectedValueOnce(noReader()).mockResolvedValueOnce({ url: 'https://storage.example/signed', mime: 'application/pdf' });
    readDetails.mockResolvedValueOnce(READ);
    expect(await readDocument('att-1', 'PAN card', FIELDS)).toEqual(READ);
    expect(request).toHaveBeenLastCalledWith({ url: '/attachments/att-1/url', method: 'GET' });
    expect(fetch).toHaveBeenCalledWith('https://storage.example/signed');
    expect(readDetails.mock.calls[0][1]).toBe('application/pdf');
  });

  it('the server’s own reading is used when it has one', async () => {
    request.mockResolvedValueOnce(READ);
    expect(await readFile(new File(['x'], 'pan.jpg', { type: 'image/jpeg' }), 'PAN card', FIELDS)).toEqual(READ);
    expect(readDetails).not.toHaveBeenCalled();
  });

  it('a refusal that holds here too is not worked around', async () => {
    request.mockRejectedValueOnce(new ApiError(403, 'OCR_NOT_ALLOWED', 'Identity documents are not read automatically.'));
    await expect(readFile(new File(['x'], 'aadhaar.jpg', { type: 'image/jpeg' }), 'Aadhaar', FIELDS)).rejects.toMatchObject({ code: 'OCR_NOT_ALLOWED' });
    expect(readDetails).not.toHaveBeenCalled();
  });

  it('switched off under Control → Integrations, nothing is read', async () => {
    switches = { reader: false };
    request.mockRejectedValueOnce(noReader());
    await expect(readFile(new File(['x'], 'pan.jpg', { type: 'image/jpeg' }), 'PAN card', FIELDS)).rejects.toMatchObject({ code: 'OCR_NOT_SET_UP' });
    expect(readDetails).not.toHaveBeenCalled();
  });
});
