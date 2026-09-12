import { PodStatus } from '@/app/trips/types';

/** Proof of delivery — part 06. Five states plus Forfeited (BR-48). */

export interface ReceivingStats {
  attachedInTransit: number;
  receivedToday: number;
  awaitingVerification: number;
  awaitingApproval: number;
  balanceHeldPaise: number;
  pastTwentyDays: number;
}

export interface ReceivingRow {
  tripId: string;
  tripCode: string;
  lrCode: string | null;
  vendorName: string;
  lane: string;
  deliveredAt: string;
  courierDocket: string | null;
  attachedAt: string | null;
  ageDays: number;
  podStatus: PodStatus;
  balanceHeldPaise: number;
}

export interface ReceivingResponse {
  stats: ReceivingStats;
  rows: ReceivingRow[];
}

export interface PendingRow {
  tripId: string;
  tripCode: string;
  lrCode: string | null;
  vendorName: string;
  clientName: string;
  lane: string;
  branchName: string;
  deliveredAt: string;
  ageDays: number;
  /** Negative once the turnaround is breached. */
  daysLeft: number;
  podStatus: PodStatus;
  penaltyPaise: number;
  balanceHeldPaise: number;
  forfeited: boolean;
}

export interface PendingResponse {
  stats: {
    pending: number;
    breached: number;
    penaltyAccruedPaise: number;
    balanceHeldPaise: number;
  };
  rows: PendingRow[];
}

export interface PodDetail {
  tripId: string;
  tripCode: string;
  indentCode: string;
  lrCode: string | null;
  vendorName: string;
  clientName: string;
  lane: string;
  deliveredAt: string;
  podStatus: PodStatus;
  podReceivedAt: string | null;
  ageDays: number;
  penaltyPaise: number;
  receipt: PodReceipt | null;
  /** Null before a receipt is logged — mirrors `receipt?.pages`, not a separately captured value. */
  pages: number | null;
  attachmentIds: string[];
  /** BR-50 — the approver may not be this person. */
  verifiedBy: string | null;
  approvedBy: string | null;
  charges: { id: string; chargeType: string; costAmountPaise: number; billedAmountPaise: number }[];
}

export interface PodReceipt {
  id: string;
  code: string;
  tripId: string;
  courierDocket: string;
  sentOn: string | null;
  receivedOn: string;
  pages: number;
  receivedBy: string;
  condition: string | null;
}

/** The clerical check. Remarks are mandatory when any of these is false. */
export interface VerifyChecklist {
  consigneeStamp: boolean;
  signedAndDated: boolean;
  lrNumberMatches: boolean;
  quantityMatchesInvoice: boolean;
  noShortageOrDamage: boolean;
}

export interface VerifyBody {
  checklist: VerifyChecklist;
  remarks?: string;
  /** BR-56 — charges are captured here, not as a separate later step. */
  charges: { chargeType: string; costAmountPaise: number; billedAmountPaise: number }[];
}
