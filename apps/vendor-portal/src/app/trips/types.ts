export type TripStatus =
  | 'PLACED'
  | 'REPORTED'
  | 'LOADED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CLOSED';

export type PodStatus = 'PENDING' | 'ATTACHED' | 'RECEIVED' | 'VERIFIED' | 'APPROVED' | 'REJECTED';

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  PLACED: 'Placement confirmed',
  REPORTED: 'Reported at plant',
  LOADED: 'Loaded, LR issued',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  CLOSED: 'Closed',
};

export const POD_STATUS_LABEL: Record<PodStatus, string> = {
  PENDING: 'Not attached',
  ATTACHED: 'Attached, awaiting the paper copy',
  RECEIVED: 'Paper copy received',
  VERIFIED: 'Verified',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

/** Vehicle documents that gate the advance (`BR-58`). */
export interface TripBlocker {
  what: string;
  why: string;
}

export interface Trip {
  id: string;
  lrNo: string | null;
  originCity: string;
  destinationCity: string;
  distanceKm: number;
  status: TripStatus;
  podStatus: PodStatus;
  podRejectionReason: string | null;
  vehicleRegistrationNo: string;
  driverName: string;
  driverPhone: string;
  freightPaise: number;
  advancePct: number;
  advancePaise: number;
  advanceReleasedAt: string | null;
  advanceUtr: string | null;
  advanceBlockers: TripBlocker[];
  balancePaise: number;
  penaltyPaise: number;
  netPayablePaise: number;
  deliveredAt: string | null;
  podDaysElapsed: number | null;
  podPenaltyPerDayPaise: number;
  billId: string | null;
  milestones: { key: string; label: string; at: string | null; done: boolean }[];
}

export interface LorryReceipt {
  lrNo: string;
  issuedAt: string;
  originCity: string;
  destinationCity: string;
  goods: string;
  weightKg: number;
  truckType: string;
  vehicleRegistrationNo: string;
  driverName: string;
  driverLicenceNo: string;
  transitDays: number;
  ewayBillNo: string;
  ewayValidUpto: string;
  freightPaise: number;
  advancePaise: number;
  balancePaise: number;
  pdfUrl: string;
}

export interface AttachPodRequest {
  files: File[];
  courierDocketNo: string;
  sentOn: string;
  note?: string;
}

export interface BillDraft {
  tripId: string;
  submittable: boolean;
  conditions: { label: string; met: boolean }[];
  freightPaise: number;
  agreedChargesPaise: number;
  billTotalPaise: number;
}

export interface BillResult {
  id: string;
  billNo: string;
  computedBalancePaise: number;
  billedPaise: number;
  variancePaise: number;
}
