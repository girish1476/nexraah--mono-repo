import { describe, expect, it } from 'vitest';
import { mintAccessToken, mockAdapter } from './index';

/**
 * One town, one branch (BR-20), from both sides: a town another branch lists
 * under "Also serves" can be neither added again nor opened as a new branch's
 * city, or a load from it would match two branches and could not be raised.
 */

const call = async (method: string, url: string, data?: unknown) => {
  localStorage.setItem('token', mintAccessToken('ADMIN'));
  const res = await mockAdapter({ method, url, data, headers: {} } as never);
  return (res.data as { data: any }).data;
};

const failure = async (method: string, url: string, data?: unknown) => {
  try {
    await call(method, url, data);
  } catch (e) {
    return String((e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? (e as Error).message);
  }
  return null;
};

describe('a town served by one branch', () => {
  it('cannot be served by a second branch, nor become a new branch’s city', async () => {
    await call('PATCH', '/branches/br-gdm', { servedCities: ['Mundra'] });
    expect(await failure('PATCH', '/branches/br-nsk', { servedCities: ['mundra'] })).toMatch(/already served/);
    expect(await failure('POST', '/branches', { name: 'Mundra port', city: ' Mundra ' })).toMatch(
      /already served by the Gandhidham branch/,
    );
  });

  it('a town nobody serves still opens a branch', async () => {
    const made = await call('POST', '/branches', { name: 'Kandla', city: 'Kandla' });
    expect(made.city).toBe('Kandla');
  });
});
