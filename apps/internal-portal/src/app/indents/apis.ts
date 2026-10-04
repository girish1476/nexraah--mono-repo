import { request } from '@/apis';
import { IndentDetail, IndentDraft, IndentListRow, IndentStage, PlacementBody, RecordQuoteBody, StaleIndent } from './types';

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

/** GET /indents/stale — nothing has happened on these for a week. */
export function listStaleIndents() {
  return request<StaleIndent[]>({ url: '/indents/stale', method: 'GET' });
}

/**
 * POST /indents/:id/cancel · `indent.manage` — the client cancelled the load. A
 * remark is required. 409 TRIP_UNDERWAY once the truck has left or an advance was paid.
 */
export function cancelIndent(id: string, reason: string) {
  return request<IndentDetail>({ url: `/indents/${id}/cancel`, method: 'POST', data: { reason } });
}

/** POST /indents/:id/keep · `indent.manage` — somebody reviewed a stale indent and it stays. */
export function keepIndent(id: string) {
  return request<{ id: string; kept: boolean }>({ url: `/indents/${id}/keep`, method: 'POST' });
}

/**
 * POST /indents/:id/reassign-transporter · `indent.reassign` (Leadership) — takes the
 * load off its transporter so another can be given it. The trip keeps its number.
 */
export function reassignTransporter(id: string, reason: string) {
  return request<IndentDetail>({ url: `/indents/${id}/reassign-transporter`, method: 'POST', data: { reason } });
}

/**
 * POST /indents/:id/quotes · `indent.manage` — the desk enters a quote a transporter gave
 * by phone or message. 422 BELOW_BAND · 409 QUOTE_EXISTS · 409 VENDOR_NOT_ACTIVE.
 */
export function recordQuote(id: string, body: RecordQuoteBody) {
  return request<IndentDetail>({ url: `/indents/${id}/quotes`, method: 'POST', data: body });
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

/**
 * POST /indents/:id/vehicle-correction · `indent.manage` — a mistyped truck
 * number put right, on the load, the trip and the lorry receipt. Open until the
 * truck is unloaded (409 TRIP_UNLOADED after).
 */
export function correctVehicle(id: string, body: { vehicleNo: string; reason: string }) {
  return request<IndentDetail>({ url: `/indents/${id}/vehicle-correction`, method: 'POST', data: body });
}

/** POST /indents/:id/placement — allocates the vehicle (and driver) to the trip the award generated. */
export function recordPlacement(id: string, body: PlacementBody) {
  return request<IndentDetail>({ url: `/indents/${id}/placement`, method: 'POST', data: body });
}

/** POST /indents/:id/trip — only for indents awarded before the award generated the trip itself. */
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
