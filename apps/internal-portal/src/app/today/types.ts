import { Issue } from '@/app/vendors/types';

/** Today — part 10 §1. Three working queues, no vanity metrics. */

export interface PendingAllocation {
  stats: {
    waiting: number;
    freightAtStakePaise: number;
    noQuotes: number;
    quotesIn: number;
    earliestPickup: string | null;
    tonnes: number;
  };
  rows: {
    id: string;
    code: string;
    clientName: string;
    lane: string;
    weightTn: number;
    truckType: string;
    pickupDate: string;
    sellRatePaise: number;
    quoteCount: number;
    branchName: string;
  }[];
}

/** BR-18 — five causes, one of which only exists because D-39 keeps above-band quotes. */
export type FailureCause =
  | 'NO_QUOTE_AT_ALL'
  | 'ONLY_ABOVE_BAND_QUOTES'
  | 'IN_BAND_NONE_AWARDED'
  | 'TRUCK_NEVER_REPORTED'
  | 'CLIENT_CANCELLED';

export interface PlacementFailures {
  stats: { failed: number; freightLostPaise: number; neverQuoted: number };
  rows: {
    id: string;
    code: string;
    clientName: string;
    lane: string;
    pickupDate: string;
    branchName: string;
    cause: FailureCause;
    sellRatePaise: number;
  }[];
}

export interface TodayResponse {
  pendingAllocation: PendingAllocation;
  placementFailures: PlacementFailures;
  vendorIssues: { rows: Issue[] };
  podOverdue: {
    rows: {
      tripId: string;
      tripCode: string;
      lane: string;
      vendorName: string;
      ageDays: number;
      balanceHeldPaise: number;
    }[];
  };
}
