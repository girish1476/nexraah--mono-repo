export type SdrKind = 'SHORTAGE' | 'DAMAGE' | 'UNLOADING_ACK';
export type SdrStatus = 'OPEN' | 'RESOLVED';

/** What went wrong, as somebody would say it. */
export const SDR_KIND_LABEL: Record<SdrKind, string> = {
  SHORTAGE: 'Shortage',
  DAMAGE: 'Damage',
  UNLOADING_ACK: 'Unloading not acknowledged',
};

export interface SdrRecord {
  id: string;
  code: string;
  tripId: string;
  tripCode: string;
  vendorId: string;
  vendorName: string;
  kind: SdrKind;
  description: string;
  /** What the person who raised it believes it costs. */
  claimedPaise: number;
  status: SdrStatus;
  /** Set when resolved: the amount to take from the transporter. */
  deductionPaise: number | null;
  /** Of the deduction, what has not yet been taken from a payment — the transporter's negative balance. */
  outstandingPaise: number;
  /** What Compliance has written off, on Leadership's mail. */
  waivedPaise: number;
  /** The payments it has been recovered from, so the trail runs both ways. */
  recoveries: { tripId: string; tripCode: string; amountPaise: number; at: string }[];
  resolutionNote: string | null;
  raisedByName: string;
  raisedAt: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
}

export interface SdrSummary {
  open: number;
  resolved: number;
  /** Deducted but not yet taken from any payment — carried to the transporter's next orders. */
  outstandingPaise: number;
}

export interface RaiseSdrBody {
  kind: SdrKind;
  description: string;
  claimedAmountPaise?: number;
}

export interface ResolveSdrBody {
  deductionPaise: number;
  note?: string;
}
