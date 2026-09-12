/** Mirrors `apps/internal-api/src/modules/clients/rate-revision.service.ts`. */

export type RateRevisionStatus = 'PENDING' | 'APPLIED' | 'REJECTED';

export interface RateRevision {
  id: string;
  status: RateRevisionStatus;
  oldRatePaise: number;
  newRatePaise: number;
  effectiveFrom: string;
  reason: string;
  /** "Nashik → Kolkata", already joined server-side. Null if the lane is gone. */
  lane: string | null;
  truckType: string | null;
  requestedByName: string | null;
  createdAt: string;
}

export const REVISION_STATUS_LABEL: Record<RateRevisionStatus, string> = {
  PENDING: 'Waiting for sign-off',
  APPLIED: 'In force',
  REJECTED: 'Turned down',
};

export const REVISION_STATUS_EMOJI: Record<RateRevisionStatus, string> = {
  PENDING: '⏳',
  APPLIED: '✅',
  REJECTED: '⛔',
};

export const REVISION_STATUS_TONE = {
  PENDING: 'flag',
  APPLIED: 'mint',
  REJECTED: 'red',
} as const;
