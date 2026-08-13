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
  distanceKm: number;
  transitDays: number;
  reportingRule: ReportingRule;
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
  vehicleId: string;
  reportingRule: ReportingRule;
}

export interface PlaceQuoteResult {
  id: string;
  loadCode: string;
  amountPaise: number;
  status: MyQuoteStatus;
  aboveBand: boolean;
}
