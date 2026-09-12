import { request } from '@/apis';
import { AuditFilterOptions, AuditPage } from './types';

/**
 * GET /audit — the trail, newest first.
 *
 * There is no POST, PATCH or DELETE here and there never will be: the table
 * refuses UPDATE and DELETE at the database, so the record cannot be edited by
 * anyone, including whoever is reading it. That is the whole point of it.
 */
export function listAuditEvents(params: {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) {
  return request<AuditPage>({ url: '/audit', method: 'GET', params });
}

/** The filter choices, read from what is actually in the trail rather than guessed. */
export function auditFilterOptions() {
  return request<AuditFilterOptions>({ url: '/audit/filters', method: 'GET' });
}

/** Everything that has ever happened to one record. */
export function auditForEntity(entityType: string, entityId: string) {
  return request<AuditPage>({ url: `/audit/${entityType}/${entityId}`, method: 'GET' });
}
