import { request } from '@/apis';
import type { Branch } from '@/app/admin/branches/types';
import {
  CheckStatus,
  ComplianceQueue,
  Issue,
  IssueDraft,
  Lead,
  MarketGapRow,
  VendorDetail,
  VendorDraft,
  VendorListRow,
  VendorStatus,
} from './types';

/** GET /branches — the branch selector on step 1 of the onboarding wizard. */
export function listBranches() {
  return request<Branch[]>({ url: '/branches', method: 'GET' });
}

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

/** POST /vendors/:id/kyc/:kind/verify · `vendor.verify` — approve is the default when no body is sent. */
export function verifyKyc(id: string, kind: string) {
  return request<{ kind: string; status: CheckStatus }>({ url: `/vendors/${id}/kyc/${kind}/verify`, method: 'POST' });
}

/** Same route as `verifyKyc`, `approve: false` — a rejection needs a reason of at least 20 characters. */
export function rejectKyc(id: string, kind: string, reason: string) {
  return request<{ kind: string; status: CheckStatus }>({
    url: `/vendors/${id}/kyc/${kind}/verify`,
    method: 'POST',
    data: { approve: false, reason },
  });
}

/**
 * GET /vendors/kyc-backfill-queue · `vendor.verify`
 * Every PAN/AADHAAR row that has a photo on file but no extracted value —
 * the onboarding wizard captured the card image for both kinds but never
 * the typed number, until the `needsReference` fix landed (2026-08-26).
 */
export interface KycBackfillRow {
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  kind: 'PAN' | 'AADHAAR';
  attachmentId: string;
  status: CheckStatus;
}
export function getKycBackfillQueue() {
  return request<KycBackfillRow[]>({ url: '/vendors/kyc-backfill-queue', method: 'GET' });
}

/**
 * PATCH /vendors/:id/kyc/:kind/value · `vendor.verify`
 * Records the value read off the already-captured photo. Does not touch
 * verification status — see the backend's own comment on why this is not
 * `submitKyc`.
 */
export function backfillKycValue(id: string, kind: string, value: string) {
  return request<{ kind: string; valueMasked: string }>({
    url: `/vendors/${id}/kyc/${kind}/value`,
    method: 'PATCH',
    data: { value },
  });
}

/** GET /attachments/:id/url — a short-lived signed URL to view an uploaded file. */
export function getAttachmentUrl(id: string) {
  return request<{ url: string; expiresAt: string }>({ url: `/attachments/${id}/url`, method: 'GET' });
}

/**
 * POST /vendors/:id/documents/:kind/verify · `vendor.verify`
 * The legal-file counterpart of `verifyKyc`. `activate` refuses until every
 * mandatory document is VERIFIED, so without this call no vendor can go
 * ACTIVE through the console. Returns `{ kind, status }` — callers re-fetch
 * the vendor rather than patching it in from the response.
 */
export function verifyDocument(id: string, kind: string) {
  return request<{ kind: string; status: CheckStatus }>({
    url: `/vendors/${id}/documents/${kind}/verify`,
    method: 'POST',
  });
}

/** Same route as `verifyDocument`, `approve: false` — a rejection needs a reason of at least 20 characters. */
export function rejectDocument(id: string, kind: string, reason: string) {
  return request<{ kind: string; status: CheckStatus }>({
    url: `/vendors/${id}/documents/${kind}/verify`,
    method: 'POST',
    data: { approve: false, reason },
  });
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
 * The response is narrow, `{ id, status }` — not a full `VendorDetail` — the
 * same re-fetch pattern as `activateVendor`/`verifyKyc`/`verifyDocument`.
 */
export function submitVendor(id: string) {
  return request<{ id: string; status: VendorStatus }>({ url: `/vendors/${id}/submit`, method: 'POST' });
}

/**
 * POST /vendors/:id/activate · `vendor.activate` → ACTIVE
 * 409 VENDOR_INCOMPLETE with the unmet list when the file is incomplete (BR-01).
 *
 * The response is deliberately narrow, not a full `VendorDetail` — the
 * caller re-fetches for that (`getVendor`), the same pattern as
 * `verifyKyc`/`verifyDocument`. `portalAccountProvisioned` is the honest
 * answer to whether this activation actually created the transporter's
 * portal login: until Supabase Auth Admin provisioning is wired up, it is
 * always `false`, and the caller should say so rather than claim a login
 * was created.
 */
export function activateVendor(id: string) {
  return request<{ id: string; status: VendorStatus; portalAccountProvisioned: boolean }>({
    url: `/vendors/${id}/activate`,
    method: 'POST',
  });
}

/**
 * POST /vendors/:id/suspend { reason } · `vendor.activate`. Puts an ACTIVE
 * transporter on hold: no new awards, portal drops to read-only, running
 * trips continue. The reason (≥ 20 chars) goes to the audit trail.
 */
export function suspendVendor(id: string, reason: string) {
  return request<{ id: string; status: VendorStatus }>({
    url: `/vendors/${id}/suspend`,
    method: 'POST',
    data: { reason },
  });
}

/** POST /vendors/:id/reinstate · `vendor.activate`. Off hold, back to ACTIVE. */
export function reinstateVendor(id: string) {
  return request<{ id: string; status: VendorStatus }>({
    url: `/vendors/${id}/reinstate`,
    method: 'POST',
  });
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

/** GET /vendors/market-gap?branch= — scoped to the caller's own branch server-side. */
export function listMarketGap(params: { branch?: string } = {}) {
  return request<MarketGapRow[]>({ url: '/vendors/market-gap', method: 'GET', params });
}

export function updateMarketGapTarget(id: string, target: number) {
  return request<MarketGapRow>({ url: `/vendors/market-gap/${id}`, method: 'PATCH', data: { target } });
}

export function listIssues(params: { status?: string } = {}) {
  return request<Issue[]>({ url: '/vendors/issues', method: 'GET', params });
}

export function createIssue(body: IssueDraft) {
  return request<Issue>({ url: '/vendors/issues', method: 'POST', data: body });
}

/** Only `status` and `note` are writable after the fact (`UpdateIssueDto`). */
export function updateIssue(id: string, patch: { status?: Issue['status']; note?: string }) {
  return request<Issue>({ url: `/vendors/issues/${id}`, method: 'PATCH', data: patch });
}

/* ---- compliance desk ---------------------------------------------------- */

/** GET /compliance/queues → the three segments of part 03 §4. */
export function getComplianceQueues() {
  return request<ComplianceQueue[]>({ url: '/compliance/queues', method: 'GET' });
}
