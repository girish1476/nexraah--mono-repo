import { request } from '@/apis';
import { AwardDecision, AwardResult, Rfq, RfqLane, RfqListResponse, RfqStatus, SourcingMode, SourcingRow } from './types';

/** GET /rfqs?status=&client= */
export function listRfqs(params: { status?: RfqStatus; client?: string } = {}) {
  return request<RfqListResponse>({ url: '/rfqs', method: 'GET', params });
}

/** GET /rfqs/:id */
export function getRfq(id: string) {
  return request<Rfq>({ url: `/rfqs/${id}`, method: 'GET' });
}

/** POST /rfqs */
export function createRfq(body: {
  clientId: string;
  cycleMonths: number;
  periodFrom: string;
  periodTo: string;
  dueAt: string;
  reference?: string;
}) {
  return request<Rfq>({ url: '/rfqs', method: 'POST', data: body });
}

/** POST /rfqs/:id/lanes — captures transit days and the reporting rule per lane. */
export function addLane(
  id: string,
  body: { origin: string; destination: string; truckType: string; transitDays: number; reportingRule: string },
) {
  return request<RfqLane>({ url: `/rfqs/${id}/lanes`, method: 'POST', data: body });
}

/**
 * PATCH /rfqs/:id/lanes/:laneId/sourcing
 * MONTHLY sends a row per month; HIGH_LOW sends two rows and the server takes
 * the midpoint. The average is computed server-side, never in the browser.
 */
export function setSourcing(id: string, laneId: string, body: { sourcingMode: SourcingMode; sourcingRows: SourcingRow[] }) {
  return request<RfqLane>({ url: `/rfqs/${id}/lanes/${laneId}/sourcing`, method: 'PATCH', data: body });
}

/**
 * PATCH /rfqs/:id/lanes/:laneId/buildup  { overheadPaise, marginPaise }
 * The quoted rate is derived from these; it is never sent and never keyed
 * (BR-36). Every component persists so a won lane can be tested later
 * against what it actually cost (R-03).
 */
export function setBuildup(id: string, laneId: string, body: { overheadPaise: number; marginPaise: number }) {
  return request<RfqLane>({ url: `/rfqs/${id}/lanes/${laneId}/buildup`, method: 'PATCH', data: body });
}

/** POST /rfqs/:id/submit · `rfq.submit` — LEADERSHIP only, fixed. 403 otherwise. */
export function submitRfq(id: string) {
  return request<Rfq>({ url: `/rfqs/${id}/submit`, method: 'POST' });
}

/** POST /rfqs/:id/award  { lanes: AwardDecision[] } → creates the rate card lanes. */
export function awardRfq(id: string, lanes: AwardDecision[]) {
  return request<AwardResult>({ url: `/rfqs/${id}/award`, method: 'POST', data: { lanes } });
}
