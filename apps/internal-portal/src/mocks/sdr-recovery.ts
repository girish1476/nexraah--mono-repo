/**
 * The fixture's copy of internal-api's `planRecovery`
 * (`modules/sdr/sdr-recovery.ts`): which resolved shortage/damage records a
 * balance payment pays down, and by how much. A sibling drift test runs both
 * through the same scenarios and fails the day they disagree.
 */

export interface RecoveryCandidate {
  id: string;
  code: string;
  tripId: string;
  tripCode: string;
  outstandingPaise: number;
  resolvedAt: string;
}

export interface Recovery {
  sdrId: string;
  sdrCode: string;
  tripCode: string;
  amountPaise: number;
  ownTrip: boolean;
  remainingAfterPaise: number;
}

export interface RecoveryPlan {
  recoveries: Recovery[];
  totalPaise: number;
  netPaise: number;
  carriedForwardPaise: number;
}

export function planRecovery(
  candidates: RecoveryCandidate[],
  tripId: string,
  availablePaise: number,
  minPayablePaise = 0,
): RecoveryPlan {
  let left = Math.max(0, availablePaise - Math.max(0, minPayablePaise));
  const ordered = [...candidates]
    .filter((c) => c.outstandingPaise > 0)
    .sort((a, b) => {
      const aOwn = a.tripId === tripId ? 0 : 1;
      const bOwn = b.tripId === tripId ? 0 : 1;
      if (aOwn !== bOwn) return aOwn - bOwn;
      if (a.resolvedAt !== b.resolvedAt) return a.resolvedAt < b.resolvedAt ? -1 : 1;
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });

  const recoveries: Recovery[] = [];
  let carriedForwardPaise = 0;
  for (const c of ordered) {
    const take = Math.min(c.outstandingPaise, left);
    left -= take;
    const remaining = c.outstandingPaise - take;
    carriedForwardPaise += remaining;
    if (take > 0) {
      recoveries.push({
        sdrId: c.id,
        sdrCode: c.code,
        tripCode: c.tripCode,
        amountPaise: take,
        ownTrip: c.tripId === tripId,
        remainingAfterPaise: remaining,
      });
    }
  }
  const totalPaise = recoveries.reduce((a, r) => a + r.amountPaise, 0);
  return { recoveries, totalPaise, netPaise: Math.max(0, availablePaise) - totalPaise, carriedForwardPaise };
}
