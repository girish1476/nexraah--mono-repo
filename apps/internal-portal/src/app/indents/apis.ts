import { request } from '@/apis';
import { IndentDetail, IndentDraft, IndentListRow, IndentStage, PlacementBody } from './types';

/** GET /indents?stage=&branch=&client= — branch scoping is server-side. */
export function listIndents(params: { stage?: IndentStage; branch?: string; client?: string } = {}) {
  return request<IndentListRow[]>({ url: '/indents', method: 'GET', params });
}

/** GET /indents/:id */
export function getIndent(id: string) {
  return request<IndentDetail>({ url: `/indents/${id}`, method: 'GET' });
}

/**
 * POST /indents · `indent.create`
 * 400 SPOT_CONFIRMATION_REQUIRED (BR-26) · 400 SPOT_BELOW_SOURCING (BR-38).
 */
export function createIndent(draft: IndentDraft) {
  return request<IndentDetail>({ url: '/indents', method: 'POST', data: draft });
}

/**
 * POST /indents/:id/award  { quoteId, reason? }
 *
 * - In band → 200, writes `buy_rate` and a QUOTE_AWARD audit row (BR-06).
 * - Above band → 202 ABOVE_BAND_PRICE; the award executes when leadership
 *   approves, replaying this payload verbatim (BR-05, D-39).
 * - Vendor not ACTIVE → 409 VENDOR_NOT_ACTIVE (BR-01).
 */
export function awardQuote(id: string, quoteId: string, reason?: string) {
  return request<IndentDetail>({ url: `/indents/${id}/award`, method: 'POST', data: { quoteId, reason } });
}

/** POST /indents/:id/placement — records vehicle, driver, licence and reported-at. */
export function recordPlacement(id: string, body: PlacementBody) {
  return request<IndentDetail>({ url: `/indents/${id}/placement`, method: 'POST', data: body });
}

/** POST /indents/:id/trip → consumes the TRP- series and opens the trip (BR-21). */
export function createTrip(id: string) {
  return request<{ id: string; code: string }>({ url: `/indents/${id}/trip`, method: 'POST' });
}

/**
 * PATCH /indents/:id/advance-pct  { advancePct, reason }
 * Always 202 ADVANCE_POLICY_CHANGE when it departs from the vendor's
 * standing policy (BR-57, D-22).
 */
export function changeIndentAdvancePct(id: string, advancePct: number, reason: string) {
  return request<never>({
    url: `/indents/${id}/advance-pct`,
    method: 'PATCH',
    data: { advancePct, reason },
  });
}
