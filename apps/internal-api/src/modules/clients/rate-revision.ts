/**
 * Client rate revision — the rules, pure and dependency-free.
 *
 * A revision closes the lane in force and opens a successor from a chosen
 * date. It never edits a rate in place, because an indent raised last month
 * was priced against last month's number and `rate-cross-check.ts` compares
 * against the lane in force on the *pickup date* — mutating the row would make
 * a correctly-priced historical indent read as a mismatch.
 */

export interface LaneForRevision {
  id: string;
  clientId: string;
  origin: string;
  destination: string;
  truckType: string;
  ratePaise: number;
  validFrom: string;
  validTo: string | null;
}

export type RevisionRefusal =
  | 'SAME_RATE'
  | 'EFFECTIVE_BEFORE_START'
  | 'EFFECTIVE_IN_PAST'
  | 'LANE_ALREADY_CLOSED'
  | 'REASON_TOO_SHORT';

export interface RevisionCheck {
  ok: boolean;
  refusal: RevisionRefusal | null;
  reason: string | null;
}

/**
 * Matches the approvals engine's own REASON_TOO_SHORT floor (>= 20 chars,
 * enforced by a check constraint on `approvals.reason`). Same number in both
 * places on purpose: a revision that passed here and was then rejected by the
 * engine would be refused twice with two different messages.
 */
export const MIN_REASON = 20;

export function checkRevision(
  lane: LaneForRevision,
  input: { newRatePaise: number; effectiveFrom: string; reason: string },
  today: Date,
): RevisionCheck {
  if (input.newRatePaise === lane.ratePaise) {
    return {
      ok: false,
      refusal: 'SAME_RATE',
      reason: 'That is the rate already in force — nothing would change.',
    };
  }

  if (!input.reason || input.reason.trim().length < MIN_REASON) {
    return {
      ok: false,
      refusal: 'REASON_TOO_SHORT',
      reason: 'Say why the rate is changing. It is what a billing dispute is argued from later.',
    };
  }

  const effective = Date.parse(input.effectiveFrom);
  if (Number.isNaN(effective)) {
    return { ok: false, refusal: 'EFFECTIVE_IN_PAST', reason: 'That is not a date.' };
  }

  if (effective <= Date.parse(lane.validFrom)) {
    return {
      ok: false,
      refusal: 'EFFECTIVE_BEFORE_START',
      reason: `The new rate has to start after the current one did (${lane.validFrom}).`,
    };
  }

  /*
   * Backdating is refused outright.
   *
   * A rate that takes effect before today would silently re-price indents
   * already raised and, worse, ones already delivered and billed. If a
   * genuinely retrospective correction is needed it belongs in a credit note
   * against the specific invoice, where it is visible, not in a rate card
   * change that quietly rewrites what a run of past loads should have cost.
   */
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (effective < startOfToday) {
    return {
      ok: false,
      refusal: 'EFFECTIVE_IN_PAST',
      reason:
        'A rate cannot start in the past — it would re-price loads already raised. Raise a credit note against the invoice instead.',
    };
  }

  if (lane.validTo && Date.parse(lane.validTo) < startOfToday) {
    return {
      ok: false,
      refusal: 'LANE_ALREADY_CLOSED',
      reason: `That agreed rate ended on ${lane.validTo}. Award a new lane rather than revising a closed one.`,
    };
  }

  return { ok: true, refusal: null, reason: null };
}

/**
 * The two rows a revision becomes: the closed original, and its successor.
 *
 * The old lane's `valid_to` is the day *before* the new one starts, so the two
 * periods abut without overlapping. An overlap would make "which rate was in
 * force" ambiguous on exactly the day somebody is arguing about.
 */
export function revisionRows(
  lane: LaneForRevision,
  input: { newRatePaise: number; effectiveFrom: string },
): { closeOldTo: string; successor: Omit<LaneForRevision, 'id'> } {
  const dayBefore = new Date(Date.parse(input.effectiveFrom) - 86_400_000).toISOString().slice(0, 10);

  return {
    closeOldTo: dayBefore,
    successor: {
      clientId: lane.clientId,
      origin: lane.origin,
      destination: lane.destination,
      truckType: lane.truckType,
      ratePaise: input.newRatePaise,
      validFrom: input.effectiveFrom,
      // Inherits the original's end date: a revision changes the price, not
      // the term of the agreement.
      validTo: lane.validTo,
    },
  };
}
