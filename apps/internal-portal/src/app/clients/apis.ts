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
