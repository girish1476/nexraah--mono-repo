import { request } from '@/apis';
import { CrossCheckResult, LorryReceipt, TripCharge, TripDetail, TripDocument, TripListRow } from './types';

/** GET /trips?q=&field=&stage=&branch=&transporter=&pod_status= */
export function listTrips(params: {
  q?: string;
  field?: string;
  stage?: string;
  branch?: string;
  transporter?: string;
  pod_status?: string;
} = {}) {
  return request<TripListRow[]>({ url: '/trips', method: 'GET', params });
}

/** GET /trips/:id */
export function getTrip(id: string) {
  return request<TripDetail>({ url: `/trips/${id}`, method: 'GET' });
}

/* ---- documents — part 05 §3 --------------------------------------------- */

export function getTripDocuments(id: string) {
  return request<TripDocument[]>({ url: `/trips/${id}/documents`, method: 'GET' });
}

/**
 * POST /trips/:id/documents/:kind
 * `keyedValues` is what the uploader typed off the document; the cross-check
 * compares those until NIC and OCR are connected (BR-32).
 */
export function uploadTripDocument(
  id: string,
  kind: string,
  body: { attachmentId?: string; keyedValues?: Record<string, string> },
) {
  return request<TripDocument>({ url: `/trips/${id}/documents/${kind}`, method: 'POST', data: body });
}

/** POST /trips/:id/documents/:kind/verify · `document.verify` → DOC_VERIFY audit row. */
export function verifyTripDocument(id: string, kind: string) {
  return request<TripDocument>({ url: `/trips/${id}/documents/${kind}/verify`, method: 'POST' });
}

/** POST /trips/:id/documents/:kind/reject  { reason } */
export function rejectTripDocument(id: string, kind: string, reason: string) {
  return request<TripDocument>({
    url: `/trips/${id}/documents/${kind}/reject`,
    method: 'POST',
    data: { reason },
  });
}

/** GET /trips/:id/cross-check — the current mismatch set (BR-32). */
export function getCrossCheck(id: string) {
  return request<CrossCheckResult>({ url: `/trips/${id}/cross-check`, method: 'GET' });
}

/**
 * POST /trips/:id/cross-check/override  { reason ≥ 20 }
 * → 202 DOC_OVERRIDE. A mismatch blocks LR generation until it is rejected
 * or overridden, because a checkpost penalty cannot be undone after dispatch.
 */
export function overrideCrossCheck(id: string, reason: string) {
  return request<never>({ url: `/trips/${id}/cross-check/override`, method: 'POST', data: { reason } });
}

/* ---- charges — part 05 §4 ------------------------------------------------ */

export function getCharges(id: string) {
  return request<TripCharge[]>({ url: `/trips/${id}/charges`, method: 'GET' });
}

/** POST /trips/:id/charges — cost and billed captured separately (BR-45). */
export function addCharge(
  id: string,
  body: { chargeType: string; costAmountPaise: number; billedAmountPaise: number },
) {
  return request<TripCharge>({ url: `/trips/${id}/charges`, method: 'POST', data: body });
}

/* ---- lorry receipt — part 05 §5 ----------------------------------------- */

export function getLr(id: string) {
  return request<LorryReceipt | null>({ url: `/trips/${id}/lr`, method: 'GET' });
}

/** PATCH /trips/:id/lr — draft autosave, every 3 seconds. */
export function patchLr(id: string, patch: Partial<LorryReceipt>) {
  return request<LorryReceipt>({ url: `/trips/${id}/lr`, method: 'PATCH', data: patch });
}

/**
 * POST /trips/:id/lr/generate
 * Consumes the LR- series inside the issuing transaction (BR-14).
 * 409 NOT_PLACED before the truck is placed (BR-13) · 409 LR_EXISTS on a
 * second attempt (BR-22).
 */
export function generateLr(id: string) {
  return request<LorryReceipt>({ url: `/trips/${id}/lr/generate`, method: 'POST' });
}

/** POST /trips/:id/lr/share — optional. Never required to advance the trip. */
export function shareLr(id: string) {
  return request<LorryReceipt>({ url: `/trips/${id}/lr/share`, method: 'POST' });
}
