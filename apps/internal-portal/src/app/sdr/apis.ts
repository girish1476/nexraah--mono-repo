import { request } from '@/apis';
import { RaiseSdrBody, ResolveSdrBody, SdrRecord, SdrStatus, SdrSummary } from './types';

/** GET /sdr?status=&vendor=&trip= */
export function listSdr(params: { status?: SdrStatus; vendor?: string; trip?: string } = {}) {
  return request<SdrRecord[]>({ url: '/sdr', method: 'GET', params });
}

/** GET /sdr/summary */
export function getSdrSummary() {
  return request<SdrSummary>({ url: '/sdr/summary', method: 'GET' });
}

/**
 * POST /trips/:id/sdr · `pod.verify` — records a shortage, damage or an
 * unacknowledged unloading. The trip's balance is on hold until it is resolved.
 * 409 NOT_DELIVERED before the load has been delivered.
 */
export function raiseSdr(tripId: string, body: RaiseSdrBody) {
  return request<SdrRecord>({ url: `/trips/${tripId}/sdr`, method: 'POST', data: body });
}

/**
 * POST /sdr/:id/waive · `pod.waive` — writes off what is still owed, on
 * Leadership's mail, recorded by Compliance. 409 NOTHING_TO_WAIVE.
 */
export function waiveSdr(id: string, body: { mailSubject: string; mailAttachmentId?: string }) {
  return request<SdrRecord>({ url: `/sdr/${id}/waive`, method: 'POST', data: body });
}

/**
 * POST /sdr/:id/resolve · `pod.approve` — fixes the amount to deduct. The
 * balance is then paid after it; anything the balance cannot cover carries to
 * the transporter's next orders.
 */
export function resolveSdr(id: string, body: ResolveSdrBody) {
  return request<SdrRecord>({ url: `/sdr/${id}/resolve`, method: 'POST', data: body });
}
