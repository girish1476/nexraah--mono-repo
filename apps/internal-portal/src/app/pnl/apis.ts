import { request } from '@/apis';
import { Granularity, PnlException, PnlResponse } from './types';

/**
 * GET /pnl?granularity=&from=&to=&branch=
 * A branch-bound caller gets only their branch — enforced at the repository
 * layer, and the test asserts the endpoint rather than the screen.
 */
export function getPnl(params: { granularity?: Granularity; from?: string; to?: string; branch?: string } = {}) {
  return request<PnlResponse>({ url: '/pnl', method: 'GET', params });
}

/** GET /pnl/exceptions — closed trips carrying zero charge rows. */
export function getPnlExceptions() {
  return request<PnlException[]>({ url: '/pnl/exceptions', method: 'GET' });
}

/** GET /pnl/export.csv — honours the active filters. */
export function pnlExportUrl(params: Record<string, string | undefined>): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4002/api/v1';
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => !!v) as [string, string][],
  ).toString();
  return `${base}/pnl/export.csv${query ? `?${query}` : ''}`;
}
