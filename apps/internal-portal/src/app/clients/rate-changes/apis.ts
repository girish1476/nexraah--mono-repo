import { request } from '@/apis';
import { RateRevision } from './types';

/** GET /clients/:id/rate-revisions — what has changed on this client's rates, newest first. */
export function listRateRevisions(clientId: string) {
  return request<RateRevision[]>({ url: `/clients/${clientId}/rate-revisions`, method: 'GET' });
}

/**
 * POST /clients/:id/rate-revisions — proposes, never applies.
 *
 * Always answers `202 approvalRequired`: the rate does not move until
 * somebody who can approve a contract countersigns, and nobody holds both
 * permissions, so this never resolves on a success path — `request()` turns
 * every 202 into a thrown `ApprovalRequiredError` (see `@/apis`). The caller
 * catches that, the same pattern `changeAdvancePolicy` uses.
 */
export function proposeRateRevision(
  clientId: string,
  body: { laneId: string; newRatePaise: number; effectiveFrom: string; reason: string },
) {
  return request<never>({
    url: `/clients/${clientId}/rate-revisions`,
    method: 'POST',
    data: body,
  });
}
