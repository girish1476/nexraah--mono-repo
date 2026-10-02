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
  /** The courier docket on record — the transporter's, or one added by whoever tracks the POD. */
  docketNo: string | null;
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
  /** E-POD or H-POD, once one has come in. */
  podKind?: PodKind | null;
  /**
   * The signed hard copy: for an E-POD, the follow-up until it reaches head
   * office; for an H-POD, the copy that was logged. With its courier slip.
   */
  hardCopy?: {
    courierDocket: string | null;
    sentOn: string | null;
    receivedOn: string | null;
    courierSlipAttachmentId: string | null;
    /** The scanned pages of the hard copy. */
    attachmentIds?: string[];
    /** When the hard copy was checked. For an E-POD, the balance waits for this. */
    verifiedAt?: string | null;
  } | null;
  /** An E-POD whose hard copy is not yet uploaded and verified — the balance is held. */
  hardCopyHoldsBalance?: boolean;
  /** The POD check covers shortage, damage and the late-delivery (transit) penalty. */
  transitPenaltyPaise?: number;
  actualTransitDays?: number | null;
  transitDaysRequired?: number | null;
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
  /** Null for an E-POD — nothing was couriered. */
  courierDocket: string | null;
  sentOn: string | null;
  receivedOn: string;
  pages: number;
  receivedBy: string;
  condition: string | null;
  podKind?: PodKind;
}

/**
 * How the proof of delivery came in. E-POD — a photo or scan uploaded from the
 * desk; H-POD — the signed hard copy received by courier.
 */
export type PodKind = 'EPOD' | 'HPOD';

export const POD_KIND_LABEL: Record<PodKind, string> = {
  EPOD: 'E-POD — photo or scan',
  HPOD: 'H-POD — signed hard copy',
};

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
  /**
   * When the shortage/damage or quantity check fails, the remarks become a
   * shortage / damage record (SDR) on the trip. Kind defaults from which check
   * failed; the amount is what it is believed to cost, fixed at resolution.
   */
  sdrKind?: 'SHORTAGE' | 'DAMAGE' | 'UNLOADING_ACK';
  sdrClaimedAmountPaise?: number;
  /** BR-56 — charges are captured here, not as a separate later step. */
  charges: { chargeType: string; costAmountPaise: number; billedAmountPaise: number }[];
}
