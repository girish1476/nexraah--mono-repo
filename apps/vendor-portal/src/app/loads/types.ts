export type TruckType = '32 ft SXL' | '22 ft container' | '40 ft trailer' | 'Open body';

export const TRUCK_TYPES: TruckType[] = [
  '32 ft SXL',
  '22 ft container',
  '40 ft trailer',
  'Open body',
];

export type ReportingRule = 'SAME_DAY' | 'NEXT_DAY' | 'SCHEDULED';

export const REPORTING_LABEL: Record<ReportingRule, string> = {
  SAME_DAY: 'Same day',
  NEXT_DAY: 'Next day',
  SCHEDULED: 'Scheduled',
};

export type MyQuoteStatus = 'SUBMITTED' | 'PENDING_APPROVAL';

/**
 * Redaction contract (part 02): no clientName, no sellRate, no quoteCount,
 * nothing about another vendor — at any depth.
 */
export interface Load {
  code: string;
  originCity: string;
  destinationCity: string;
  truckType: TruckType;
  weightKg: number;
  goods: string;
  /**
   * Nullable: the API sends `distanceKm: null` on every load and trip today
   * (`portal-loads.service.ts`, `portal-trips.service.ts` — no distance
   * provider is wired). Declaring it `number` here made the screens call
   * `.toLocaleString()` on null and throw; only the fixture, which
   * hardcodes numbers, kept them standing.
   */
  distanceKm: number | null;
  /**
   * Nullable: `indents.transit_days` and `indents.reporting_rule` are both
   * optional columns (`db/types.ts`) and `PortalLoadDto` declares both
   * `T | null` (`portal.dto.ts`) — an indent posted without either sails
   * through untouched. Declaring these required here is the same class of
   * bug `distanceKm` above already documents: the screens rendered the
   * literal string "null" for an indent missing either field.
   */
  transitDays: number | null;
  reportingRule: ReportingRule | null;
  remarks: string | null;
  pickupAt: string;
  bandLowPaise: number;
  bandHighPaise: number;
  advancePct: number;
  myQuote: { id: string; status: MyQuoteStatus; amountPaise: number } | null;
}

/** Subset of the fleet record the quote form needs (full record: part 04). */
export interface Vehicle {
  id: string;
  registrationNo: string;
  truckType: TruckType;
  capacityKg: number;
}

export interface PlaceQuoteRequest {
  amountPaise: number;
  vehicleRegistrationNo: string;
  driverMobile: string;
  reportingRule: ReportingRule;
  /** Only meaningful when `reportingRule` is `SCHEDULED` — optional, never blocks submission. */
  scheduledDate?: string;
}

export interface PlaceQuoteResult {
  id: string;
  loadCode: string;
  amountPaise: number;
  status: MyQuoteStatus;
  aboveBand: boolean;
}
