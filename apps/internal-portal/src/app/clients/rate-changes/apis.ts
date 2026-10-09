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
  body: {
    laneId: string;
    newRatePaise: number;
    effectiveFrom: string;
    reason: string;
    approvalMailSubject: string;
    approvalMailAttachmentId?: string;
  },
) {
  return request<never>({
    url: `/clients/${clientId}/rate-revisions`,
    method: 'POST',
    data: body,
  });
}

/**
 * POST /clients/:id/rate-card — proposes a lane the client's rate card does not
 * have yet (`rate.revise`). Like a revision it never resolves: it answers
 * `202 approvalRequired`, which `request()` throws as `ApprovalRequiredError`,
 * and the lane exists only once somebody who can approve a contract agrees.
 */
export function proposeRateLane(
  clientId: string,
  body: {
    origin: string;
    destination: string;
    truckType: string;
    ratePaise: number;
    rateBasis: 'FTL' | 'PMT';
    transitDays: number;
    validFrom: string;
    validTo?: string;
    reason: string;
    transitPenaltyApplies: boolean;
    transitPenaltyPerDayPaise?: number;
    approvalMailSubject: string;
    approvalMailAttachmentId?: string;
  },
) {
  return request<never>({ url: `/clients/${clientId}/rate-card`, method: 'POST', data: body });
}

/** PATCH /clients/:id/rate-revisions/:revisionId — corrects a rate change still waiting for sign-off. */
export function editRateRevision(
  clientId: string,
  revisionId: string,
  body: { newRatePaise?: number; effectiveFrom?: string; reason?: string },
) {
  return request<RateRevision>({ url: `/clients/${clientId}/rate-revisions/${revisionId}`, method: 'PATCH', data: body });
}
