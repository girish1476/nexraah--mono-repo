/** Clients and rate cards — part 04 §1. */

export type Engagement = 'SPOT' | 'CONTRACT';

export interface Client {
  id: string;
  code: string;
  name: string;
  billingCity: string;
  gstin: string | null;
  contact: string;
  phone: string;
  email: string;
  engagement: Engagement;
  agreementNo: string | null;
  validFrom: string | null;
  validTo: string | null;
  agreementAttachmentId?: string | null;
  creditDays: number;
  serviceLevel: string;
  status: 'ACTIVE' | 'SUSPENDED';
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
}

export type ClientDraft = Omit<Client, 'id' | 'code' | 'status' | 'outstandingPaise'>;
