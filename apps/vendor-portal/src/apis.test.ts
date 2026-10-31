import { describe, expect, it } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { api } from './apis';

/** One request through the real interceptors, answered without a network. */
function fail(status: number | null, data?: unknown) {
  return api
    .get('/portal/anything', {
      adapter: async (config: InternalAxiosRequestConfig) => {
        const response = status === null ? undefined : ({ status, data, statusText: '', headers: {}, config } as AxiosResponse);
        throw new AxiosError(`Request failed with status code ${status}`, String(status), config, null, response);
      },
    })
    .then(
      () => {
        throw new Error('expected the request to fail');
      },
      (e: AxiosError) => e,
    );
}

describe('what a failed request says', () => {
  it("is the server's own sentence, not the status line", async () => {
    const e = await fail(409, { error: { code: 'QUOTE_EXISTS', message: 'You have already quoted on this load.' } });
    expect(e.message).toBe('You have already quoted on this load.');
  });

  it('keeps the response, for screens that branch on the code', async () => {
    const e = await fail(409, { error: { code: 'QUOTE_EXISTS', message: 'You have already quoted on this load.' } });
    expect((e.response?.data as { error: { code: string } }).error.code).toBe('QUOTE_EXISTS');
  });

  it('says so plainly when the server cannot be reached', async () => {
    const e = await fail(null);
    expect(e.message).toBe('Could not reach Nexraah. Check your signal and try again.');
  });

  it('leaves the message alone when the server gave no sentence', async () => {
    const e = await fail(500, '<html>Bad gateway</html>');
    expect(e.message).toBe('Request failed with status code 500');
  });
});
