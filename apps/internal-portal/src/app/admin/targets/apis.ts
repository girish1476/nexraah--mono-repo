import { request } from '@/apis';
import { DeskTargets, MonthTargets, TargetMetric } from './types';

/**
 * GET /targets/desk — target against achieved for the signed-in person's desk.
 * No permission: which measures and which branch come from their own role and
 * branch, decided by the server.
 */
export function getDeskTargets() {
  return request<DeskTargets>({ url: '/targets/desk', method: 'GET' });
}

/** GET /targets?month=YYYY-MM */
export function listTargets(month: string) {
  return request<MonthTargets>({ url: '/targets', method: 'GET', params: { month } });
}

/**
 * PUT /targets · `config.manage` — one branch, one month. A number sets a
 * measure (a count, or paise), null takes its target away.
 */
export function setTargets(body: {
  month: string;
  branchId: string;
  targets: Partial<Record<TargetMetric, number | null>>;
}) {
  return request<MonthTargets>({ url: '/targets', method: 'PUT', data: body });
}
