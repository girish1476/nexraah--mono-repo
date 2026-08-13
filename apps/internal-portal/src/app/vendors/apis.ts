import { request } from '@/apis';
import {
  ComplianceQueue,
  Issue,
  Lead,
  MarketGapRow,
  VendorDetail,
  VendorDraft,
  VendorListRow,
  VendorStatus,
} from './types';

/* ---- search and detail -------------------------------------------------- */

/** GET /vendors?q=&status=&branch= */
export function listVendors(params: { q?: string; status?: VendorStatus; branch?: string } = {}) {
  return request<VendorListRow[]>({ url: '/vendors', method: 'GET', params });
}

/** GET /vendors/:id */
export function getVendor(id: string) {
  return request<VendorDetail>({ url: `/vendors/${id}`, method: 'GET' });
}

/* ---- onboarding wizard — part 03 §1 ------------------------------------- */

/** POST /vendors — creates the DRAFT the wizard saves into. */
export function createVendorDraft(draft: VendorDraft) {
  return request<VendorDetail>({ url: '/vendors', method: 'POST', data: draft });
}

/** PATCH /vendors/:id — per-step draft save. */
export function patchVendor(id: string, patch: Partial<VendorDraft>) {
  return request<VendorDetail>({ url: `/vendors/${id}`, method: 'PATCH', data: patch });
}

/**
 * POST /vendors/:id/kyc/:kind
 * `value` is what the operator keyed; for AADHAAR the server stores the last
 * four digits only and never the full number (BR-04).
 */
export function submitKyc(
  id: string,
  kind: string,
  body: { value: string; route: 'API' | 'MANUAL'; attachmentId?: string },
) {
  return request<VendorDetail>({ url: `/vendors/${id}/kyc/${kind}`, method: 'POST', data: body });
}

/** POST /vendors/:id/kyc/:kind/verify · `vendor.verify` */
export function verifyKyc(id: string, kind: string) {
  return request<VendorDetail>({ url: `/vendors/${id}/kyc/${kind}/verify`, method: 'POST' });
}

/** POST /vendors/:id/documents/:kind */
export function uploadVendorDocument(
  id: string,
  kind: string,
  body: { attachmentId: string; reference?: string; validFrom?: string; validTo?: string },
) {
  return request<VendorDetail>({ url: `/vendors/${id}/documents/${kind}`, method: 'POST', data: body });
}

/**
 * POST /vendors/:id/submit → PENDING_VERIFICATION
 * 409 VENDOR_INCOMPLETE with `details.unmet[]` when BR-02 or BR-03 is unmet.
 */
export function submitVendor(id: string) {
  return request<VendorDetail>({ url: `/vendors/${id}/submit`, method: 'POST' });
}

/**
 * POST /vendors/:id/activate · `vendor.activate` → ACTIVE
 * Creates the transporter's portal login and sends the first-login SMS.
 * 409 VENDOR_INCOMPLETE with the unmet list when the file is incomplete (BR-01).
 */
export function activateVendor(id: string) {
  return request<VendorDetail>({ url: `/vendors/${id}/activate`, method: 'POST' });
}

/**
 * PATCH /vendors/:id/advance-policy · `vendor.advance_policy`
 * Always 202 ADVANCE_POLICY_CHANGE — never applied directly (BR-57).
 */
export function changeAdvancePolicy(id: string, advancePct: number, reason: string) {
  return request<never>({
    url: `/vendors/${id}/advance-policy`,
    method: 'PATCH',
    data: { advancePct, reason },
  });
}

/* ---- leads, market gap, issues ------------------------------------------ */

export function listLeads() {
  return request<Lead[]>({ url: '/vendors/leads', method: 'GET' });
}

export function createLead(body: Partial<Lead>) {
  return request<Lead>({ url: '/vendors/leads', method: 'POST', data: body });
}

export function updateLead(id: string, patch: Partial<Lead>) {
  return request<Lead>({ url: `/vendors/leads/${id}`, method: 'PATCH', data: patch });
}

/** GET /vendors/market-gap?branch= — branch-scoped for BRANCH_MGR server-side. */
export function listMarketGap(params: { branch?: string } = {}) {
  return request<MarketGapRow[]>({ url: '/vendors/market-gap', method: 'GET', params });
}

export function updateMarketGapTarget(id: string, target: number) {
  return request<MarketGapRow>({ url: `/vendors/market-gap/${id}`, method: 'PATCH', data: { target } });
}

export function listIssues(params: { status?: string } = {}) {
  return request<Issue[]>({ url: '/vendors/issues', method: 'GET', params });
}

export function createIssue(body: Partial<Issue>) {
  return request<Issue>({ url: '/vendors/issues', method: 'POST', data: body });
}

export function updateIssue(id: string, patch: Partial<Issue>) {
  return request<Issue>({ url: `/vendors/issues/${id}`, method: 'PATCH', data: patch });
}

/* ---- compliance desk ---------------------------------------------------- */

/** GET /compliance/queues → the three segments of part 03 §4. */
export function getComplianceQueues() {
  return request<ComplianceQueue[]>({ url: '/compliance/queues', method: 'GET' });
}
