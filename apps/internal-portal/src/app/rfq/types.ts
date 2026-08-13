/** RFQ and rate management — part 09. */

export type RfqStatus = 'DRAFT' | 'SOURCING' | 'QUOTED' | 'SUBMITTED' | 'AWARDED' | 'LOST' | 'CLOSED';
export type SourcingMode = 'MONTHLY' | 'HIGH_LOW';
export type LaneOutcome = 'WON' | 'LOST' | 'WITHDRAWN';

export interface SourcingRow {
  /** `YYYY-MM` for MONTHLY; null for the two HIGH_LOW rows. */
  month: string | null;
  ratePaise: number;
}

export interface RfqLane {
  id: string;
  origin: string;
  destination: string;
  truckType: string;
  /** Client requirements that must reach the indent and the LR (BR-27, D-21). */
  transitDays: number;
  reportingRule: 'SAME_DAY' | 'NEXT_DAY' | 'SCHEDULED';
  sourcingMode: SourcingMode;
  sourcingRows: SourcingRow[];
  sourcingAvgPaise: number;
  overheadPaise: number;
  marginPaise: number;
  /** Derived, never keyed: sourcing + overhead + margin (BR-36). */
  quotedRatePaise: number;
  outcome: LaneOutcome | null;
  awardedRatePaise: number | null;
}

export interface Rfq {
  id: string;
  clientId: string;
  clientName: string;
  cycleMonths: 3 | 6 | 12;
  periodFrom: string;
  periodTo: string;
  dueAt: string;
  reference: string;
  status: RfqStatus;
  submittedBy: string | null;
  submittedAt: string | null;
  lanes: RfqLane[];
}

export interface RfqListResponse {
  stats: {
    open: number;
    lanesOut: number;
    lanesWon: number;
    lanesLost: number;
    valueWonPaise: number;
  };
  rows: {
    id: string;
    clientName: string;
    reference: string;
    cycleMonths: number;
    periodFrom: string;
    periodTo: string;
    dueAt: string;
    status: RfqStatus;
    laneCount: number;
  }[];
}

export interface AwardDecision {
  laneId: string;
  outcome: LaneOutcome;
  awardedRatePaise?: number;
}

export interface AwardResult {
  rfqId: string;
  status: RfqStatus;
  /** Exactly what was written — the preview must match this (BR-37). */
  rateCardLanesCreated: {
    id: string;
    rfqLaneId: string;
    origin: string;
    destination: string;
    truckType: string;
    ratePaise: number;
    validFrom: string;
    validTo: string;
  }[];
}
