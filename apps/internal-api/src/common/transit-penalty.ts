/**
 * The late-delivery ("transit") penalty: what a transporter is charged for
 * taking longer than the client's transit days to deliver.
 *
 * Distinct from the proof-of-delivery penalty in `pod-penalty.ts`, which is for
 * late *paperwork*. This one is for late *goods*. The clock starts the day
 * loading was done. Everything else belongs to the lane's rate, set when the
 * rate is entered: the transit days, whether a penalty applies at all, and what
 * a late day costs — because all three vary with the client, the route and the
 * truck type.
 *
 * Pure and dependency-free, so the trip service and its tests share one copy
 * and the portal's fixture can mirror it.
 */

const DAY_MS = 86_400_000;

export interface TransitPenaltyInput {
  /** When the transit clock started: the day loading was done (or, failing that, departure). Absent — no penalty. */
  startedAt: string | null;
  deliveredAt: string;
  /** The lane's transit days. Absent when the rate carried none. */
  requiredDays: number | null;
  /** Whether the lane charges a late-delivery penalty at all. */
  applies: boolean;
  /** The lane's penalty per late day, in paise. */
  perDayPaise: number;
}

export interface TransitPenalty {
  /** Whole days on the road, a part-day counting as a day. Null when the start was not recorded. */
  actualDays: number | null;
  lateDays: number;
  penaltyPaise: number;
}

export function computeTransitPenalty(input: TransitPenaltyInput): TransitPenalty {
  if (!input.startedAt) return { actualDays: null, lateDays: 0, penaltyPaise: 0 };
  const elapsed = new Date(input.deliveredAt).getTime() - new Date(input.startedAt).getTime();
  const actualDays = Math.max(1, Math.ceil(elapsed / DAY_MS));
  if (input.requiredDays === null || input.requiredDays === undefined) {
    return { actualDays, lateDays: 0, penaltyPaise: 0 };
  }
  const lateDays = Math.max(0, actualDays - input.requiredDays);
  return { actualDays, lateDays, penaltyPaise: input.applies ? lateDays * Math.max(0, input.perDayPaise) : 0 };
}
