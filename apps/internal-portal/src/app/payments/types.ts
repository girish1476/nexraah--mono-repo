import { UnmetCondition } from '@/apis';

/** Payments — part 07. Every figure is paise; none of it is keyed (BR-08). */

export interface Beneficiary {
  accountHolder: string;
  account: string;
  ifsc: string;
}

/** BR-09 — all five are NOT NULL on `payments`. */
export interface PaymentCapture {
  mode: string;
  transferType: string;
  remittingAccount: string;
  utr: string;
  valueDate: string;
}

export interface AdvanceQueueRow {
  indentId: string;
  indentCode: string;
  tripId: string;
  tripCode: string;
  vendorName: string;
  lane: string;
  branchName: string;
  advancePct: number;
  grossPaise: number;
  blocked: boolean;
  unmetCount: number;
}

export interface AdvanceDetail {
  tripId: string;
  tripCode: string;
  indentCode: string;
  vendorName: string;
  beneficiary: Beneficiary;
  advancePct: number;
  buyRatePaise: number;
  grossPaise: number;
  /** BR-33 / D-24 — nothing is deducted in this release. Always 0. */
  tdsPaise: number;
  netPaise: number;
  unmet: UnmetCondition[];
  cleared: { key: string; label: string }[];
  releasable: boolean;
  alreadyReleased: boolean;
}

export interface BalanceQueueRow {
  tripId: string;
  tripCode: string;
  vendorName: string;
  lane: string;
  branchName: string;
  podStatus: string;
  podAgeDays: number;
  netPaise: number;
  penaltyPaise: number;
  blocked: boolean;
  unmetCount: number;
}

/** The four lines the balance screen must show, not a single net figure. */
export interface BalanceBreakdown {
  billablePaise: number;
  buyRatePaise: number;
  chargeCostPaise: number;
  advancePaidPaise: number;
  penaltyPaise: number;
  penaltyDays: number;
  penaltyPerDayPaise: number;
  grossPaise: number;
  netPaise: number;
}

export interface BalanceDetail {
  tripId: string;
  tripCode: string;
  vendorName: string;
  lane: string;
  beneficiary: Beneficiary;
  podStatus: string;
  podAgeDays: number;
  breakdown: BalanceBreakdown;
  unmet: UnmetCondition[];
  releasable: boolean;
  alreadyReleased: boolean;
}

export interface Payment {
  id: string;
  tripId: string;
  tripCode: string;
  kind: 'ADVANCE' | 'BALANCE';
  grossPaise: number;
  penaltyPaise: number;
  netPaise: number;
  tdsPaise: number;
  releasedBy: string;
  releasedAt: string;
  utr: string;
}

/** BR-53 — a bill cannot exist before its POD is approved. */
export interface VendorBill {
  id: string;
  tripId: string;
  tripCode: string;
  vendorId: string;
  vendorName: string;
  billNo: string;
  billDate: string;
  attachmentId: string;
  freightPaise: number;
  chargesPaise: number;
  totalPaise: number;
  submittedAt: string;
  computedBalancePaise: number;
  variancePaise: number;
  podStatus: string;
  status: 'SUBMITTED' | 'ACCEPTED' | 'QUERIED';
  queryNote?: string;
}
