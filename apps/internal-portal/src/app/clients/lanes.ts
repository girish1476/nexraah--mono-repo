import { RateCardLane } from './types';

/**
 * A revised rate leaves two rows for one route: the original, closed the day
 * before the change starts, and its successor. `GET /clients/:id/rate-card`
 * returns both (history is not deleted), so any screen that means "what we
 * charge them" has to pick the live rows out of that list itself.
 *
 * A lane is dropped once it has ended. A lane that has a successor starting
 * later is kept — it is still the price in force today — but flagged with the
 * date it gets replaced, so nobody proposes a second change against a rate
 * that is already about to move (the server would refuse it anyway).
 */
export interface LiveLane {
  lane: RateCardLane;
  /** Start date of the lane that replaces this one, if that has been agreed. */
  replacedFrom: string | null;
}

const routeKey = (l: RateCardLane) => `${l.origin}·${l.destination}·${l.truckType}`;

export function liveLanes(lanes: RateCardLane[], on: string = new Date().toISOString().slice(0, 10)): LiveLane[] {
  const open = lanes.filter((l) => !l.validTo || l.validTo >= on);
  return open.map((lane) => {
    const later = open
      .filter((o) => o.id !== lane.id && routeKey(o) === routeKey(lane) && o.validFrom > lane.validFrom)
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
    return { lane, replacedFrom: later?.validFrom ?? null };
  });
}
