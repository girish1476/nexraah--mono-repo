import { request } from '@/apis';
import { Client, ClientDraft, PendingRateLane, RateCardLane } from './types';

/** GET /clients?q= */
export function listClients(params: { q?: string } = {}) {
  return request<Client[]>({ url: '/clients', method: 'GET', params });
}

/** GET /clients/:id */
export function getClient(id: string) {
  return request<Client>({ url: `/clients/${id}`, method: 'GET' });
}

/** POST /clients */
export function createClient(draft: Partial<ClientDraft>) {
  return request<Client>({ url: '/clients', method: 'POST', data: draft });
}

/** PATCH /clients/:id */
export function patchClient(id: string, patch: Partial<ClientDraft>) {
  return request<Client>({ url: `/clients/${id}`, method: 'PATCH', data: patch });
}

/**
 * GET /clients/:id/rate-card — read-only, from `rate_card_lanes`.
 * Lanes are never keyed here; they are what RFQ award wrote (BR-37).
 */
export function getRateCard(id: string) {
  return request<RateCardLane[]>({ url: `/clients/${id}/rate-card`, method: 'GET' });
}

/** GET /clients/:id/rate-card/pending — lanes proposed and waiting for approval. */
export function getPendingRateLanes(id: string) {
  return request<PendingRateLane[]>({ url: `/clients/${id}/rate-card/pending`, method: 'GET' });
}

/**
 * PUT /clients/:id/rate-card/:laneId/band — `client.manage`.
 *
 * The first band on a lane applies at once and resolves. Changing one that
 * already exists answers `202 approvalRequired` for Leadership, which
 * `request()` turns into a thrown `ApprovalRequiredError` — callers catch it
 * and say the change is waiting, they do not treat it as a failure.
 */
export function setLaneBand(
  clientId: string,
  laneId: string,
  body: { bidMinPaise: number; bidMaxPaise: number; reason?: string },
) {
  return request<{ applied: true; laneId: string; bidMinPaise: number; bidMaxPaise: number }>({
    url: `/clients/${clientId}/rate-card/${laneId}/band`,
    method: 'PUT',
    data: body,
  });
}

/*
 * Deleting a duplicate rate — Leadership or an administrator only (the server
 * checks the role). Each takes the reason, which is kept with the record.
 */

/** DELETE /clients/:id/rate-card/:laneId — a lane on the rate card. Loads already raised keep their price. */
export function deleteRateLane(clientId: string, laneId: string, reason: string) {
  return request<{ laneId: string; deleted: true }>({
    url: `/clients/${clientId}/rate-card/${laneId}`,
    method: 'DELETE',
    data: { reason },
  });
}

/** DELETE /clients/:id/rate-card/pending/:approvalId — a lane still waiting for sign-off. */
export function deletePendingRateLane(clientId: string, approvalId: string, reason: string) {
  return request<{ approvalId: string; deleted: true }>({
    url: `/clients/${clientId}/rate-card/pending/${approvalId}`,
    method: 'DELETE',
    data: { reason },
  });
}

/** DELETE /clients/:id/rate-revisions/:revisionId — a rate change still waiting for sign-off. */
export function deleteRateRevision(clientId: string, revisionId: string, reason: string) {
  return request<{ revisionId: string; deleted: true }>({
    url: `/clients/${clientId}/rate-revisions/${revisionId}`,
    method: 'DELETE',
    data: { reason },
  });
}

/* ---- corrections to rates ------------------------------------------------- */

export interface LaneCorrection {
  ratePaise?: number;
  rateBasis?: 'FTL' | 'PMT';
  transitDays?: number;
  validFrom?: string;
  validTo?: string | null;
}

/**
 * PATCH /clients/:id/rate-card/:laneId · `rate.revise`, Leadership or Admin —
 * an agreed rate typed wrongly, put right at once. The reason stays on the lane.
 */
export function correctRateLane(clientId: string, laneId: string, body: LaneCorrection & { reason: string }) {
  return request<RateCardLane>({ url: `/clients/${clientId}/rate-card/${laneId}`, method: 'PATCH', data: body });
}

/** PATCH /clients/:id/rate-card/pending/:approvalId — corrects a lane still waiting for sign-off; it stays waiting. */
export function editPendingRateLane(clientId: string, approvalId: string, body: LaneCorrection) {
  return request<PendingRateLane>({ url: `/clients/${clientId}/rate-card/pending/${approvalId}`, method: 'PATCH', data: body });
}

/** A proposed lane that was turned down — kept so it can be corrected and sent again. */
export interface RejectedRateLane {
  approvalId: string;
  requesterName: string;
  rejectedAt: string | null;
  /** What the person who turned it down wrote. */
  note: string | null;
  reason: string;
  origin: string;
  destination: string;
  truckType: string;
  ratePaise: number;
  rateBasis?: 'FTL' | 'PMT';
  transitDays: number;
  validFrom: string;
  validTo: string | null;
  transitPenaltyApplies?: boolean;
  transitPenaltyPerDayPaise?: number;
  approvalMailSubject?: string;
}

/** GET /clients/:id/rate-card/rejected */
export function getRejectedRateLanes(clientId: string) {
  return request<RejectedRateLane[]>({ url: `/clients/${clientId}/rate-card/rejected`, method: 'GET' });
}

/** POST /clients/:id/rate-card/rejected/:approvalId/dismiss — the corrected one went in; stop offering this one. */
export function dismissRejectedRateLane(clientId: string, approvalId: string) {
  return request<{ approvalId: string }>({ url: `/clients/${clientId}/rate-card/rejected/${approvalId}/dismiss`, method: 'POST' });
}
