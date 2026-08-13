import { request } from '@/apis';
import { ApprovalKind, ApprovalRow } from './types';

/** GET /approvals?status=PENDING&kind= */
export function listApprovals(params: { status?: string; kind?: ApprovalKind } = {}) {
  return request<ApprovalRow[]>({ url: '/approvals', method: 'GET', params });
}

/**
 * POST /approvals/:id/approve
 * Replays the stored payload verbatim — never recomputed. 409 when the
 * payload is no longer valid (vendor suspended, indent cancelled).
 */
export function approve(id: string) {
  return request<ApprovalRow>({ url: `/approvals/${id}/approve`, method: 'POST' });
}

/** POST /approvals/:id/reject  { note } — note is mandatory. */
export function reject(id: string, note: string) {
  return request<ApprovalRow>({ url: `/approvals/${id}/reject`, method: 'POST', data: { note } });
}
