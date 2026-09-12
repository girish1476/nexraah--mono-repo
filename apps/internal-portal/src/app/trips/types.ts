/** Trips and the lorry receipt — part 05. */

export type TripStage = 'OPEN' | 'IN_TRANSIT' | 'DELIVERED' | 'CLOSED';
export type PodStatus = 'PENDING' | 'ATTACHED' | 'RECEIVED' | 'VERIFIED' | 'APPROVED' | 'WAIVED' | 'FORFEITED';
export type DocStatus = 'MISSING' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface TripListRow {
  id: string;
  code: string;
  lrCode: string | null;
  indentCode: string;
  clientName: string;
  vendorName: string;
  branchName: string;
  lane: string;
  vehicleNo: string;
  stage: TripStage;
  podStatus: PodStatus;
  deliveredAt: string | null;
  buyRatePaise: number;
  sellRatePaise: number;
  advancePaidPaise: number;
  balancePaidPaise: number;
  podPenaltyPaise: number;
}

export interface TripDocument {
  kind: string;
  label: string;
  group: 'CLIENT' | 'VEHICLE' | 'DRIVER' | 'LR' | 'POD';
  /** True for the eight of BR-58, as configured in `config.advance_document_set`. */
  gatesAdvance: boolean;
  status: DocStatus;
  attachmentId: string | null;
  uploadedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectReason: string | null;
  /** Feeds the BR-32 cross-check until NIC/OCR lands. */
  keyedValues: Record<string, string>;
}

export interface TripCharge {
  id: string;
  chargeType: string;
  /** BR-45 — cost and billed value are separate columns, never one figure. */
  costAmountPaise: number;
  billedAmountPaise: number;
  capturedBy: string;
  capturedAt: string;
}

export interface CrossCheckMismatch {
  field: string;
  a: { source: string; value: string };
  b: { source: string; value: string };
}

export interface CrossCheckResult {
  runnable: boolean;
  waitingOn: string[];
  mismatches: CrossCheckMismatch[];
  overridden: boolean;
}

export interface LorryReceipt {
  code: string | null;
  status: 'DRAFT' | 'BOOKED' | 'RELEASED' | 'IN_TRANSIT' | 'DELIVERED';
  lrDate: string | null;
  bookedAt: string | null;
  /** BR-22 — sharing is optional and never a required workflow step. */
  sharedAt: string | null;
  consignor: { name: string; address: string; gstin: string };
  consignee: { name: string; address: string; gstin: string };
  goods: { description: string; packages: number; weightTn: number; valuePaise: number };
  invoice: { number: string; datedOn: string; valuePaise: number };
  eway: { number: string; validTill: string };
  vehicle: { registration: string; type: string };
  driver: { name: string; licence: string; phone: string };
  transitDays: number;
  remarks: string;
  chargeHeads: {
    freightPaise: number;
    loadingPaise: number;
    unloadingPaise: number;
    detentionPaise: number;
    otherPaise: number;
    discountPaise: number;
  };
}

export interface TripDetail extends TripListRow {
  indentId: string;
  vehicleType: string;
  capacityTn: number;
  driverName: string;
  driverLicence: string;
  /** No `driver_phone` column exists anywhere in the backend schema — genuinely absent data, never sent. */
  driverPhone?: string | null;
  /** No `distance_km` column exists anywhere in the backend schema — genuinely absent data, never sent. */
  distanceKm?: number;
  weightTn: number;
  transitDaysRequired: number;
  actualTransitDays: number | null;
  transitDelay: boolean;
  remarks: string;
  advancePct?: number;
  ewayNo: string | null;
  ewayValidTill: string | null;
  podReceivedAt: string | null;
  podClosureBasis: string | null;
  billed: boolean;
  documents: TripDocument[];
  charges: TripCharge[];
  lr: LorryReceipt | null;
}
