import { request } from '@/apis';
import { PendingResponse, PodDetail, PodReceipt, ReceivingResponse, VerifyBody } from './types';

/** GET /pod/receiving?branch= · `pod.receive` */
export function getReceiving(params: { branch?: string } = {}) {
  return request<ReceivingResponse>({ url: '/pod/receiving', method: 'GET', params });
}

/** GET /pod/pending?branch=&transporter=&ageing= — the chase list, oldest first. */
export function getPending(params: { branch?: string; transporter?: string; ageing?: string } = {}) {
  return request<PendingResponse>({ url: '/pod/pending', method: 'GET', params });
}

/** GET /pod/:tripId */
export function getPod(tripId: string) {
  return request<PodDetail>({ url: `/pod/${tripId}`, method: 'GET' });
}

/**
 * POST /pod/:tripId/receive · `pod.receive`
 * Consumes the PDR- series, which is scoped per branch. **This is what stops
 * the clock** — attachment in the transporter portal does not (BR-49, D-35).
 *
 * `sentOn` is required, not optional: `pod_attach_needs_docket` (BR-51) is a
 * DB CHECK tying it to `courierDocket` — both null or both set — and
 * `courierDocket` is always sent, so a receipt logged without a sent-on date
 * fails the constraint. `ReceivePodDto` enforces the same on the server.
 */
export function receivePod(
  tripId: string,
  body: { courierDocket: string; sentOn: string; receivedOn: string; pages: number; receivedBy?: string; condition?: string },
) {
  return request<PodReceipt>({ url: `/pod/${tripId}/receive`, method: 'POST', data: body });
}

/** POST /pod/:tripId/verify · `pod.verify` — checklist, remarks and charges. */
export function verifyPod(tripId: string, body: VerifyBody) {
  return request<{ tripId: string; podStatus: string }>({
    url: `/pod/${tripId}/verify`,
    method: 'POST',
    data: body,
  });
}

/**
 * POST /pod/:tripId/reject  { reason } · `pod.verify`
 * Clears `pod_received_at`; rejection does not stop the clock (BR-52).
 */
export function rejectPod(tripId: string, reason: string) {
  return request<{ tripId: string; podStatus: string }>({
    url: `/pod/${tripId}/reject`,
    method: 'POST',
    data: { reason },
  });
}

/**
 * POST /pod/:tripId/approve · `pod.approve`
 * 409 APPROVER_IS_VERIFIER when the same user verified it (BR-50) — refused
 * at the service and by a database constraint, as well as by the button not
 * rendering.
 */
export function approvePod(tripId: string) {
  return request<{ tripId: string; podStatus: string }>({
    url: `/pod/${tripId}/approve`,
    method: 'POST',
  });
}

/**
 * POST /pod/:tripId/waive  { reason ≥ 30 } · `pod.waive`
 * Always 202 PENALTY_WAIVER — compliance proposes, leadership approves. A
 * penalty is never waived at the desk (BR-43).
 */
export function waivePenalty(tripId: string, reason: string) {
  return request<never>({ url: `/pod/${tripId}/waive`, method: 'POST', data: { reason } });
}
