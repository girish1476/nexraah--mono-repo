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
  transitDays: number;
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
}

export type ClientDraft = Omit<Client, 'id' | 'code' | 'status' | 'outstandingPaise'>;
