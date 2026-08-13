/** Home — part 10 §2. Reporting, not operations. */

export interface HomeResponse {
  /** Block M — this month. */
  month: {
    trips: number;
    revenuePaise: number;
    costPaise: number;
    marginPaise: number;
    vendorsUsed: number;
    onTimePct: number;
    placedByPickup: number;
    failures: number;
    distinctTrucks: number;
  };
  branches: { branchName: string; trips: number; revenuePaise: number; costPaise: number }[];
  topClients: { clientName: string; revenuePaise: number }[];
  /** Block P — POD collection. */
  pod: {
    delivered: number;
    collected: number;
    pending: number;
    withinTat: number;
    breached: number;
    collectionPct: number;
    penaltyAccruedPaise: number;
  };
  /** Block S — where things stand. */
  standing: {
    advanceOutstandingPaise: number;
    balancePendingPaise: number;
    receivablesPaise: number;
    unbilledTrips: number;
  };
}
