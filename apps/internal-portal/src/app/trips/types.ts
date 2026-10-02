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
  /** When the truck left — the list's "on the road since". */
  departedAt?: string | null;
  clientId?: string | null;
  indentId?: string | null;
}

export interface TripDocument {
  kind: string;
  label: string;
  group: 'CLIENT' | 'VEHICLE' | 'DRIVER' | 'LOADING' | 'LR' | 'POD';
  /** True for the kinds of BR-58, as configured in `config.advance_document_set`. */
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
  driverName: string | null;
  driverLicence: string | null;
  /** The driver's mobile number, captured when the vehicle is allocated. */
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
  /** Late-delivery penalty charged to the transporter, at the client's per-day rate. */
  transitPenaltyPaise: number;
  billed: boolean;
  /** One Operations person per trip who runs loading and uploads the loading and vehicle documents. */
  loadingSupervisorId: string | null;
  loadingSupervisorName: string | null;
  loadingStartedAt: string | null;
  loadingCompletedAt: string | null;
  /** Order-cycle milestones — marked on the tracking sheet. */
  reachedLoadingAt?: string | null;
  departedAt?: string | null;
  reachedDestinationAt?: string | null;
  documents: TripDocument[];
  charges: TripCharge[];
  lr: LorryReceipt | null;
}

/**
 * One line on a trip's tracking sheet. `UPDATE` is a typed position; the rest
 * are the order cycle's milestones, in order: reached the loading point,
 * loaded, started (`DEPARTED`), reached the unloading point, unloaded.
 */
export type TrackingKind = 'UPDATE' | 'REACHED_LOADING' | 'LOADED' | 'DEPARTED' | 'REACHED' | 'UNLOADED' | 'EWAY_EXTENDED';

/** How the truck is doing at a position update. */
export type TrackingStatus = 'MOVING' | 'HALTED' | 'CHECKPOST' | 'TRAFFIC' | 'BREAKDOWN' | 'ACCIDENT' | 'WAITING_TO_UNLOAD' | 'OTHER';

export const TRACKING_STATUS_LABEL: Record<TrackingStatus, string> = {
  MOVING: 'Moving',
  HALTED: 'Halted / resting',
  CHECKPOST: 'At a checkpost',
  TRAFFIC: 'Stuck in traffic / road blocked',
  BREAKDOWN: 'Breakdown',
  ACCIDENT: 'Accident',
  WAITING_TO_UNLOAD: 'Waiting to unload',
  OTHER: 'Other',
};

/** What can be posted — starting the trip and unloading have their own actions. */
export type TrackingPostKind = 'UPDATE' | 'REACHED_LOADING' | 'LOADED' | 'REACHED';

export interface TrackingUpdate {
  id: string;
  kind: TrackingKind;
  location: string;
  lat: number | null;
  lng: number | null;
  note: string | null;
  status?: TrackingStatus | null;
  recordedAt: string;
  recordedByName: string | null;
}

export interface TrackingSheet {
  /** The e-way bill riding with the truck — extended on the road when it runs out before unloading. */
  eway?: { ewayNo: string | null; validTill: string | null; uploaded: boolean };
  tripId: string;
  stage: TripStage;
  vehicleNo: string | null;
  fromCity: string | null;
  toCity: string | null;
  reachedLoadingAt: string | null;
  loadedAt: string | null;
  departedAt: string | null;
  reachedDestinationAt: string | null;
  deliveredAt: string | null;
  updates: TrackingUpdate[];
}
