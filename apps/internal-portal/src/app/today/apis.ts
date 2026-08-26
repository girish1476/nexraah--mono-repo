import { request } from '@/apis';
import { TodayResponse } from './types';

/**
 * GET /reports/today · `indent.view`
 * Branch scoping for a branch-bound caller is applied at the repository layer, never
 * here and never in a controller (part 10 §4).
 */
export function getToday() {
  return request<TodayResponse>({ url: '/reports/today', method: 'GET' });
}
