import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupIfsc } from './ifsc';

function mockFetchOnce(impl: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lookupIfsc', () => {
  it('returns the branch on a 200', async () => {
    mockFetchOnce(
      () =>
        new Response(
          JSON.stringify({
            BANK: 'HDFC Bank',
            BRANCH: 'PARK STREET',
            CITY: 'JAIPUR',
            STATE: 'RAJASTHAN',
            ADDRESS: '3 PARK STREET M I ROAD',
          }),
          { status: 200 },
        ),
    );

    const result = await lookupIfsc('HDFC0001234');
    expect(result).toEqual({
      status: 'found',
      branch: {
        bank: 'HDFC Bank',
        branch: 'PARK STREET',
        city: 'JAIPUR',
        state: 'RAJASTHAN',
        address: '3 PARK STREET M I ROAD',
      },
    });
  });

  it('calls the exact documented endpoint shape with the code uppercased-as-given (no silent mutation)', async () => {
    const fetchSpy = vi.fn(() => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await lookupIfsc('HDFC0001234');
    expect(fetchSpy).toHaveBeenCalledWith('https://ifsc.razorpay.com/HDFC0001234', expect.anything());
  });

  it('returns not_found on a 404 rather than throwing', async () => {
    mockFetchOnce(() => new Response('', { status: 404 }));
    expect(await lookupIfsc('AAAA0999999')).toEqual({ status: 'not_found' });
  });

  it('returns a soft error on a non-404 failure status, never throws', async () => {
    mockFetchOnce(() => new Response('', { status: 500 }));
    const result = await lookupIfsc('HDFC0001234');
    expect(result.status).toBe('error');
  });

  it('returns a soft error when the network call itself fails, never throws', async () => {
    mockFetchOnce(() => Promise.reject(new TypeError('network down')));
    const result = await lookupIfsc('HDFC0001234');
    expect(result).toEqual({ status: 'error', message: 'Could not reach the bank lookup service.' });
  });

  it('propagates an AbortError instead of swallowing it as a soft error', async () => {
    mockFetchOnce(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    await expect(lookupIfsc('HDFC0001234')).rejects.toThrow('aborted');
  });
});
