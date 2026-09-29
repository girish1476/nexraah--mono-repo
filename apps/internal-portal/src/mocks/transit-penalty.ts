/**
 * The fixture's copy of internal-api's `computeTransitPenalty`
 * (`common/transit-penalty.ts`). A sibling drift test runs both through the
 * same scenarios and fails the day they disagree.
 */

const DAY_MS = 86_400_000;

export interface TransitPenaltyInput {
  startedAt: string | null;
  deliveredAt: string;
  requiredDays: number | null;
  applies: boolean;
  perDayPaise: number;
}

export interface TransitPenalty {
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
