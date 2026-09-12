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
  /**
   * Nullable: the API sends `distanceKm: null` on every load and trip today
   * (`portal-loads.service.ts`, `portal-trips.service.ts` — no distance
   * provider is wired). Declaring it `number` here made the screens call
   * `.toLocaleString()` on null and throw; only the fixture, which
   * hardcodes numbers, kept them standing.
   */
  distanceKm: number | null;
  status: TripStatus;
  podStatus: PodStatus;
  podRejectionReason: string | null;
  vehicleRegistrationNo: string;
  /**
   * Nullable: `driverName` is `trips.driver_name`, an optional column, and
   * `driverPhone` is snapshotted from `lorry_receipts.driver->>'phone'`
   * (`portal-trips.repository.ts`) — so it is null on every trip until an LR
   * is booked. `PortalTripDto` declares both `string | null` (`portal.dto.ts`).
   * Declaring these required here rendered the literal string "null" on the
   * trip detail screen (`Driver: null · null`) for any trip before LOADED.
   */
  driverName: string | null;
  driverPhone: string | null;
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

/**
 * Mirrors `PortalLorryReceiptDto` (`portal.dto.ts`). Several fields are
 * genuinely nullable there — `weightKg`/`truckType` from `trips.weight_kg` /
 * `trips.vehicle_type`, `driverName`/`driverLicenceNo`/`transitDays` from
 * columns the DTO itself types `| null`, and `pdfUrl` which
 * `portal-trips.service.ts` sets to `null` on every response today (no
 * server-side renderer exists yet). Declaring these required rendered the
 * literal string "null" (or `NaN` for `weightKg / 1000`) on the lorry-receipt
 * and printable-copy screens whenever a field was unset — the same bug class
 * `Load`/`Trip`'s `distanceKm` above already documents.
 */
export interface LorryReceipt {
  lrNo: string;
  issuedAt: string;
  originCity: string;
  destinationCity: string;
  goods: string;
  weightKg: number | null;
  truckType: string | null;
  vehicleRegistrationNo: string;
  driverName: string | null;
  driverLicenceNo: string | null;
  transitDays: number | null;
  ewayBillNo: string | null;
  ewayValidUpto: string | null;
  freightPaise: number;
  advancePaise: number;
  balancePaise: number;
  pdfUrl: string | null;
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
