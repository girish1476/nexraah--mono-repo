/** Clients and rate cards — part 04 §1. */

import type { SupplySource } from '@/app/admin/branches/types';

export type Engagement = 'SPOT' | 'CONTRACT';

/**
 * The five states a client can actually be in, matching the database
 * (`20260825040000_client_onboarding.sql`). This used to read
 * `ACTIVE | SUSPENDED` — neither of which is a value the column can hold apart
 * from ACTIVE — so every newly created client, which now starts as DRAFT,
 * rendered as a red "On hold" pointing staff at Finance. The desk that clears
 * a draft is Compliance, not Finance.
 */
export type ClientStatus =
  | 'DRAFT'
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'REJECTED'
  | 'INACTIVE';

/** What each state means on screen, and who has to act to move it on. */
export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  DRAFT: 'Being set up',
  PENDING_VERIFICATION: 'With compliance',
  ACTIVE: 'Active',
  REJECTED: 'Turned down',
  INACTIVE: 'Stood down',
};

export const CLIENT_STATUS_REASON: Record<ClientStatus, string> = {
  DRAFT: 'Still being filled in — submit it to compliance when the file is complete',
  PENDING_VERIFICATION: 'Compliance is checking the paperwork — no bookings until they clear it',
  REJECTED: 'Compliance turned this client down — see the reason on file',
  INACTIVE: 'This client was stood down — no new bookings',
  ACTIVE: 'Cleared for bookings',
};

export const CLIENT_STATUS_TONE: Record<ClientStatus, 'mint' | 'flag' | 'red' | 'grey'> = {
  DRAFT: 'grey',
  PENDING_VERIFICATION: 'flag',
  ACTIVE: 'mint',
  REJECTED: 'red',
  INACTIVE: 'grey',
};

export interface Client {
  id: string;
  code: string;
  name: string;
  billingCity: string;
  /**
   * Where the client's invoices are addressed: the street address, the state
   * and the PIN code, printed under their name on every invoice. Optional so a
   * client added before these were asked for still loads — their invoices show
   * the city alone until the address is filled in.
   */
  billingAddress?: string | null;
  billingState?: string | null;
  billingPincode?: string | null;
  gstin: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  engagement: Engagement;
  agreementNo: string | null;
  validFrom: string | null;
  validTo: string | null;
  agreementAttachmentId?: string | null;
  creditDays: number;
  serviceLevel: string | null;
  /** Whether this client wants a weighment slip with each load. Off unless asked for. */
  needsWeighmentSlip?: boolean;
  status: ClientStatus;
  outstandingPaise: number;
}

/**
 * Read-only on this side. Every row carries `rfqLaneId` because a rate card
 * line with no RFQ provenance cannot exist (BR-37, part 02 §3).
 */
export interface RateCardLane {
  id: string;
  rfqLaneId: string;
  origin: string;
  destination: string;
  truckType: string;
  ratePaise: number;
  /** FTL — the rate is for the whole truck; PMT — per metric tonne. Absent reads as FTL. */
  rateBasis?: RateBasis;
  transitDays: number;
  /** Whether a late delivery on this lane is charged to the transporter, and what a late day costs. */
  transitPenaltyApplies: boolean;
  transitPenaltyPerDayPaise: number;
  /** The subject of the BD/Leadership mail this rate was approved against. */
  approvalMailSubject?: string | null;
  reportingRule: 'SAME_DAY' | 'NEXT_DAY' | 'SCHEDULED';
  validFrom: string;
  validTo: string;
  /**
   * Where this lane's vehicles come from, copied off the RFQ lane at award —
   * copied, not linked, so the sheet still reads "union" after the quote lane
   * is re-worked. Null is a real state ("Not recorded"), never hidden.
   */
  supplySource: SupplySource | null;
  supplySourceLabel: string | null;
  supplyRemarks: string | null;
  /**
   * The floor and ceiling a transporter quote is judged against on this lane,
   * copied onto every indent raised against it. Null until somebody sets it —
   * setting the first one is direct, changing one that exists goes to
   * Leadership.
   */
  bidMinPaise: number | null;
  bidMaxPaise: number | null;
}

/** A lane proposed for a client's rate card, waiting for approval — not on the rate card yet. */
export interface PendingRateLane {
  approvalId: string;
  requesterName: string;
  proposedAt: string;
  origin: string;
  destination: string;
  truckType: string;
  ratePaise: number;
  rateBasis?: RateBasis;
  transitDays: number;
  validFrom: string;
  validTo: string | null;
}

/**
 * How a client's lane rate is agreed. Some clients give a price for the whole
 * truck (FTL, full truck load); others per metric tonne (PMT), so a load is
 * priced at rate × weight.
 */
export type RateBasis = 'FTL' | 'PMT';

export const RATE_BASIS_LABEL: Record<RateBasis, string> = {
  FTL: 'FTL — per truck',
  PMT: 'PMT — per tonne',
};

/** "₹64,200 / truck" or "₹2,450 / tonne" — how a lane rate reads everywhere. */
export function rateWithBasis(inrText: string, basis: RateBasis | undefined | null): string {
  return `${inrText} / ${basis === 'PMT' ? 'tonne' : 'truck'}`;
}

/** What one load on a lane is billed at: the rate, or rate × weight for a per-tonne lane. */
export function laneFreightPaise(lane: { ratePaise: number; rateBasis?: RateBasis | null }, weightTn: number): number {
  return lane.rateBasis === 'PMT' && weightTn > 0 ? Math.round(lane.ratePaise * weightTn) : lane.ratePaise;
}

/** Only Leadership or an administrator delete a duplicate rate. */
export const RATE_DELETE_ROLES = ['LEADERSHIP', 'ADMIN'] as const;

export type ClientDraft = Omit<Client, 'id' | 'code' | 'status' | 'outstandingPaise'>;
