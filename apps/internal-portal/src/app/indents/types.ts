/** Indents — part 04. */

export type IndentStage = 'OPEN' | 'VENDOR_ASSIGNED' | 'VEHICLE_PLACED' | 'TRIP_CREATED';
export type RateSource = 'CONTRACT' | 'SPOT';
export type BandPosition = 'IN_BAND' | 'ABOVE_BAND';
export type ReportingRule = 'SAME_DAY' | 'NEXT_DAY' | 'SCHEDULED';

export interface IndentListRow {
  id: string;
  code: string;
  clientName: string;
  lane: string;
  material: string;
  weightTn: number;
  truckType: string;
  pickupDate: string;
  sellRatePaise: number;
  buyRatePaise: number | null;
  quoteCount: number;
  stage: IndentStage;
  branchName: string;
  /** Written nightly by the `placement-failure` job (BR-18). */
  failureCause: string | null;
}

export interface Quote {
  id: string;
  code: string;
  vendorId: string;
  vendorName: string;
  /** BR-01 — a quote from a non-ACTIVE vendor cannot be awarded. */
  vendorStatus: string;
  amountPaise: number;
  truckRegistration: string;
  /** Below `bid_min` never reaches this screen — refused at entry (BR-05, D-39). */
  bandPosition: BandPosition;
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';
  submittedAt: string;
  remarks: string;
}

export interface IndentDetail {
  id: string;
  code: string;
  clientId: string;
  clientName: string;
  branchId: string;
  branchName: string;
  fromCity: string;
  toCity: string;
  material: string;
  weightTn: number;
  truckType: string;
  pickupDate: string;
  transitDays: number;
  reportingRule: ReportingRule;
  remarks: string;
  /** Internal only. Never present on any transporter-facing response (BR-55). */
  sellRatePaise: number;
  /** Written by the award, at the moment of the decision (BR-06). */
  buyRatePaise: number | null;
  rateSource: RateSource;
  rateCardLaneId: string | null;
  sourcingRatePaise: number | null;
  spotConfirmationAttachmentId: string | null;
  bidMinPaise: number;
  bidMaxPaise: number;
  /** BR-39 — the band is read-only from publication, quotes or no quotes. */
  bandLocked: boolean;
  advancePct: number;
  stage: IndentStage;
  vendorId: string | null;
  awardedQuoteId: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  driverLicence: string | null;
  reportedAt: string | null;
  failureCause: string | null;
  /**
   * No `distance_km` column exists anywhere in the backend schema — this is
   * genuinely absent data, not a missing join, so it stays optional and the
   * detail page only renders the Distance row when it's present.
   */
  distanceKm?: number;
  quotes: Quote[];
}

export interface IndentDraft {
  clientId: string;
  /** No `branchId` — the server derives the branch from `fromCity` (BR-20). */
  fromCity: string;
  toCity: string;
  material: string;
  weightTn: number;
  truckType: string;
  pickupDate: string;
  transitDays: number;
  reportingRule: ReportingRule;
  remarks?: string;
  rateSource: RateSource;
  sellRatePaise: number;
  sourcingRatePaise?: number;
  spotConfirmationAttachmentId?: string;
  rateCardLaneId?: string;
  bidMinPaise: number;
  bidMaxPaise: number;
  advancePct: number;
  distanceKm?: number;
}

export interface PlacementBody {
  vehicleNo: string;
  driverName: string;
  driverLicence: string;
  reportedAt: string;
  /** BR-42 — late reporting is a transit delay in its own right. */
  transitDelay: boolean;
  remarks?: string;
}
