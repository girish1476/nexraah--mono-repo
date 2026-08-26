/**
 * Rate cross-verification — does the price on this indent match the price we
 * agreed with this client for this lane?
 *
 * Nothing checked before. A CONTRACT indent stored `rate_card_lane_id` and
 * `sell_rate` side by side and never compared them: the lane could belong to a
 * different client, cover a different route or truck type, have expired months
 * ago, or carry a completely different rate, and the indent was accepted. The
 * only rate rule in `indents.service.create` was BR-38, which is SPOT-only.
 *
 * The consequence is quiet and financial. An under-priced contract load bills
 * the client less than the contract entitles us to, and nothing in the app
 * ever notices — there is no report that reconciles indent rates against the
 * rate card, because until now there was nothing to reconcile against.
 *
 * Pure and dependency-free, like the ladder and the expiry rule: testable
 * without a database, and mirrorable by the fixture without a second copy of
 * the reasoning.
 */

export interface RateCardLaneLike {
  id: string;
  clientId: string;
  origin: string;
  destination: string;
  truckType: string;
  /** The agreed price, in paise. */
  ratePaise: number;
  validFrom: string;
  validTo: string | null;
}

export interface IndentRateFacts {
  clientId: string;
  fromCity: string;
  toCity: string;
  truckType: string;
  sellRatePaise: number;
  pickupDate: string;
}

export type RateMismatch =
  | 'WRONG_CLIENT'
  | 'LANE_NOT_IN_EFFECT'
  | 'ROUTE_MISMATCH'
  | 'TRUCK_TYPE_MISMATCH'
  | 'RATE_MISMATCH';

export interface RateCrossCheck {
  ok: boolean;
  mismatch: RateMismatch | null;
  /** Plain words an operator can act on, never just "invalid". */
  reason: string | null;
  /** What the contract says, when the disagreement is about money. */
  agreedRatePaise?: number;
}

/** Case- and whitespace-insensitive: "Nashik " and "nashik" are one place. */
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether the lane is in force on the pickup date.
 *
 * Checked against **pickup**, not against today. A load being raised now for
 * a pickup after the contract lapses is priced against a rate we will no
 * longer have agreed — and one raised late for a pickup inside the term is
 * legitimately priced at that term's rate. The date the goods move is the
 * date the price belongs to.
 */
export function laneInEffect(lane: RateCardLaneLike, pickupDate: string): boolean {
  const pickup = Date.parse(pickupDate);
  if (Number.isNaN(pickup)) return false;
  if (pickup < Date.parse(lane.validFrom)) return false;
  if (lane.validTo && pickup > Date.parse(lane.validTo)) return false;
  return true;
}

/**
 * Compare an indent against the rate card lane it names.
 *
 * Order matters: identity first (is this even the right client's lane), then
 * whether it applies at all, then what it covers, then the money. Reporting a
 * rate mismatch on a lane belonging to another client would be true and
 * useless.
 */
export function crossCheckRate(indent: IndentRateFacts, lane: RateCardLaneLike): RateCrossCheck {
  if (lane.clientId !== indent.clientId) {
    return {
      ok: false,
      mismatch: 'WRONG_CLIENT',
      reason: 'That rate card lane belongs to a different client.',
    };
  }

  if (!laneInEffect(lane, indent.pickupDate)) {
    const until = lane.validTo ? ` It ran ${lane.validFrom} to ${lane.validTo}.` : ` It starts ${lane.validFrom}.`;
    return {
      ok: false,
      mismatch: 'LANE_NOT_IN_EFFECT',
      reason: `The agreed rate for this lane is not in force on the pickup date.${until}`,
    };
  }

  if (!sameText(lane.origin, indent.fromCity) || !sameText(lane.destination, indent.toCity)) {
    return {
      ok: false,
      mismatch: 'ROUTE_MISMATCH',
      reason: `That rate is agreed for ${lane.origin} → ${lane.destination}, not ${indent.fromCity} → ${indent.toCity}.`,
    };
  }

  if (!sameText(lane.truckType, indent.truckType)) {
    return {
      ok: false,
      mismatch: 'TRUCK_TYPE_MISMATCH',
      reason: `That rate is agreed for a ${lane.truckType}, not a ${indent.truckType}.`,
    };
  }

  if (lane.ratePaise !== indent.sellRatePaise) {
    /*
     * Exact match, deliberately — no tolerance band.
     *
     * A contract rate is a number both sides signed. "Close enough" has no
     * meaning in a billing dispute, and a tolerance would only ever be used to
     * wave through the drift it was meant to catch. If the price genuinely
     * differs, that is a spot load (which carries its own written
     * confirmation, BR-26) or a rate revision — both of which leave a record.
     */
    return {
      ok: false,
      mismatch: 'RATE_MISMATCH',
      reason:
        'This price does not match the rate agreed with the client for this lane. Raise it as a spot load with the client’s written confirmation, or have the rate revised.',
      agreedRatePaise: lane.ratePaise,
    };
  }

  return { ok: true, mismatch: null, reason: null };
}
