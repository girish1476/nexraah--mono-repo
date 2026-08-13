/**
 * FE is built ahead of vendor-api. Every page `apis.ts` calls the real
 * endpoint unless NEXT_PUBLIC_MOCK is on, in which case it resolves the
 * fixture shaped exactly like the contract in the repo-root `FE.md`.
 * Delete the fixtures — not the call — once an endpoint lands.
 */
export const USE_MOCK = process.env.NEXT_PUBLIC_MOCK === '1';

export const mock = <T>(data: T, ms = 180): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(data), ms));
