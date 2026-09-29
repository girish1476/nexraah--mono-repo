/**
 * Adding a lane to a client's rate card outside an RFQ — the rules, pure and
 * dependency-free (same shape as `rate-revision.ts`).
 *
 * The rate card used to be written only by an RFQ award, so a client who
 * agreed prices on paper had none until a whole quotation cycle had been run.
 * A directly added lane is still a commitment to bill at a number, so it goes
 * through the same second signature a revision does.
 */

export interface NewLaneInput {
  origin: string;
  destination: string;
  truckType: string;
  ratePaise: number;
  transitDays: number;
  validFrom: string;
  validTo: string | null;
  reason: string;
}

export interface ExistingLane {
  id: string;
  validFrom: string;
  validTo: string | null;
}

export type NewLaneRefusal =
  | 'SAME_CITY'
  | 'BAD_DATES'
  | 'REASON_TOO_SHORT'
  | 'LANE_EXISTS';

export interface NewLaneCheck {
  ok: boolean;
  refusal: NewLaneRefusal | null;
  reason: string | null;
}

const MIN_REASON = 20;

/** Trimmed and collapsed, so "  Pune " and "pune" are the same city when routes are compared. */
export const routePart = (v: string) => v.trim().replace(/\s+/g, ' ');
export const sameRoutePart = (a: string, b: string) => routePart(a).toLowerCase() === routePart(b).toLowerCase();

/** Inclusive on both ends; a null end is open-ended. ISO dates compare as strings. */
export function periodsOverlap(
  a: { from: string; to: string | null },
  b: { from: string; to: string | null },
): boolean {
  return (a.to === null || b.from <= a.to) && (b.to === null || a.from <= b.to);
}

/**
 * `sameRoute` are the client's lanes for this origin, destination and truck
 * type. Two lanes for one route may not cover the same day: "which rate was in
 * force" would be ambiguous on exactly the day somebody is arguing about. A
 * rate that is already agreed is changed through a revision, not added twice.
 */
export function checkNewLane(input: NewLaneInput, sameRoute: ExistingLane[]): NewLaneCheck {
  if (sameRoutePart(input.origin, input.destination)) {
    return { ok: false, refusal: 'SAME_CITY', reason: 'The pickup and drop cities are the same.' };
  }
  if (Number.isNaN(Date.parse(input.validFrom)) || (input.validTo !== null && Number.isNaN(Date.parse(input.validTo)))) {
    return { ok: false, refusal: 'BAD_DATES', reason: 'That is not a date.' };
  }
  if (input.validTo !== null && input.validTo < input.validFrom) {
    return { ok: false, refusal: 'BAD_DATES', reason: 'The rate cannot end before it starts.' };
  }
  if (!input.reason || input.reason.trim().length < MIN_REASON) {
    return {
      ok: false,
      refusal: 'REASON_TOO_SHORT',
      reason: 'Say where this rate was agreed. The person signing it off decides from this.',
    };
  }
  const clash = sameRoute.find((l) =>
    periodsOverlap({ from: input.validFrom, to: input.validTo }, { from: l.validFrom, to: l.validTo }),
  );
  if (clash) {
    return {
      ok: false,
      refusal: 'LANE_EXISTS',
      reason:
        'This client already has an agreed rate for that route and truck type over those dates. ' +
        'Change it under Rate revision instead of adding it twice.',
    };
  }
  return { ok: true, refusal: null, reason: null };
}
