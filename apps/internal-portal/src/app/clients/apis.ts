import { request } from '@/apis';
import { Client, ClientDraft, RateCardLane } from './types';

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
