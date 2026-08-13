/**
 * P&L — part 10 §3 (BR-35, D-05).
 *
 * Cost is the placement rate paid to the transporter **plus every other cost
 * the company incurs on that load**. There is no assumed percentage and no
 * blanket overhead allocation anywhere in this shape — the flat monthly branch
 * overhead used in the prototype is withdrawn.
 */

export type Granularity = 'DAILY' | 'MONTHLY' | 'QUARTERLY';

export interface PnlRow {
  period: string;
  placementPaise: number;
  loadingPaise: number;
  unloadingPaise: number;
  detentionPaise: number;
  otherPaise: number;
  costPaise: number;
  revenuePaise: number;
  marginPaise: number;
}

export interface PnlResponse {
  /** Says out loud what the caller is allowed to see. */
  scope: string;
  rows: PnlRow[];
}

/** Trips closed with no charges captured — they overstate margin (R-01). */
export interface PnlException {
  tripId: string;
  tripCode: string;
  lane: string;
  vendorName: string;
  branchName: string;
  deliveredAt: string;
  buyRatePaise: number;
}
