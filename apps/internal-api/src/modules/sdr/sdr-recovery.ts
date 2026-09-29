/**
 * Which resolved shortage/damage records a balance payment pays down, and by
 * how much.
 *
 * Pure and dependency-free, so the payments service and its tests share one
 * copy of the rule, and the portal's fixture mirrors it.
 *
 * The rule: a balance payment for a trip first pays down that trip's own
 * records, then any older ones carried forward from the transporter's earlier
 * trips, oldest first. It never takes more than the payment has left above a
 * small floor: a payment is never reduced to nothing, so a deduction bigger than
 * the balance takes all but `minPayablePaise` and the remainder stays
 * outstanding for the next trip.
 */

export interface RecoveryCandidate {
  id: string;
  code: string;
  tripId: string;
  tripCode: string;
  outstandingPaise: number;
  /** ISO timestamp the record was resolved. */
  resolvedAt: string;
}

export interface Recovery {
  sdrId: string;
  sdrCode: string;
  tripCode: string;
  amountPaise: number;
  /** True when the record belongs to the trip being paid, false when carried forward from an earlier one. */
  ownTrip: boolean;
  remainingAfterPaise: number;
}

export interface RecoveryPlan {
  recoveries: Recovery[];
  totalPaise: number;
  /** What is left of the payment after the deductions; never below zero. */
  netPaise: number;
  /** Still to be taken from later payments, across every record. */
  carriedForwardPaise: number;
}

export function planRecovery(
  candidates: RecoveryCandidate[],
  tripId: string,
  availablePaise: number,
  /** Always left payable, however large the deduction. A balance smaller than this is paid whole. */
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
  return {
    recoveries,
    totalPaise,
    netPaise: Math.max(0, availablePaise) - totalPaise,
    carriedForwardPaise,
  };
}
