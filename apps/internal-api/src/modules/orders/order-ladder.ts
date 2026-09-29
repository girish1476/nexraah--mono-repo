/**
 * The ten-step ladder, as a pure function with no dependencies.
 *
 * Deliberately importable by anything. It has no NestJS decorators, no
 * repository, no config access and no imports at all — because the point of
 * pulling it out of `OrdersService` is that a test (or the fixture adapter,
 * or anything else that needs to answer "which step is this order on") can
 * reach it without standing up a module or a database.
 *
 * Why this file exists at all: there are two implementations of this ladder in
 * the repo — this one, and the mirror in the portal's fixture adapter that the
 * demo actually runs on. Two copies of a decision can drift, and the drift is
 * invisible until somebody runs with mocks off. Making this one importable
 * means the portal's test suite can run the same scenarios through both and
 * fail loudly the day they disagree, which is the next best thing to there
 * being only one copy.
 *
 * `OrderStatus` is declared here rather than imported from `db/types` so the
 * file stays dependency-free. The two unions are structurally identical and
 * the compiler enforces it: `OrdersService` assigns the result of `ladder()`
 * straight into a `db/types` `OrderStatus`, so a divergence fails the build.
 */

/**
 * The ten steps, plus two branches that sit outside them.
 *
 * `FAILED` and `POD_FORFEITED` are both terminal exits, not rungs. An order
 * takes one when it stops for a reason the ladder has no step for: nobody
 * could be found to carry it, or the proof of delivery never arrived and the
 * transporter's balance was forfeited. Neither will ever reach step 10, and
 * both must be visibly distinct from an order that did.
 */
export type OrderStatus =
  | 'FAILED'
  | 'POD_FORFEITED'
  | 'INDENT_CREATED'
  | 'TRIP_GENERATED'
  | 'LR_ISSUED'
  | 'ADVANCE_DOCS_UPLOADED'
  | 'ADVANCE_PAID'
  | 'TRACKING'
  | 'UNLOADED'
  | 'POD_UPLOADED'
  | 'POD_VERIFIED'
  | 'BALANCE_RELEASED';

/** The ten steps, in order. Index + 1 is the step number. */
export const ORDER_LADDER: OrderStatus[] = [
  'INDENT_CREATED',
  'TRIP_GENERATED',
  'LR_ISSUED',
  'ADVANCE_DOCS_UPLOADED',
  'ADVANCE_PAID',
  'TRACKING',
  'UNLOADED',
  'POD_UPLOADED',
  'POD_VERIFIED',
  'BALANCE_RELEASED',
];

export function stepNoFor(status: OrderStatus): number {
  // FAILED never left placement, so it reports step 1 rather than step 0 —
  // "one of ten, and stuck" reads correctly; "zero of ten" does not.
  if (status === 'FAILED') return 1;
  // A forfeited order got as far as the proof stage and stops there for good.
  // Nine of ten is the truth: it reached step 9's position and will never
  // reach step 10, because there is no balance left to release.
  if (status === 'POD_FORFEITED') return 9;
  const i = ORDER_LADDER.indexOf(status);
  return i === -1 ? 1 : i + 1;
}

/**
 * Whether an order is finished, one way or the other.
 *
 * `FAILED` is deliberately NOT here. FLOWS.md §6 draws it looping back — a
 * placement that failed can be re-quoted and rejoin the ladder — so closing it
 * would drop it out of the open list while somebody is still trying to place
 * it, which is the opposite of what that queue is for.
 */
export function isTerminal(status: OrderStatus): boolean {
  return status === 'BALANCE_RELEASED' || status === 'POD_FORFEITED';
}

/**
 * Every legal `trips.pod_status`, from the schema's own check constraint
 * (`20260814090100_c1_schema.sql:472`).
 *
 * Exported so tests enumerate it from here rather than typing their own list
 * — a hand-written list silently stops covering a value the day one is added,
 * which is the same failure it is supposed to guard against.
 */
export const POD_STATUSES = [
  'PENDING',
  'ATTACHED',
  'RECEIVED',
  'VERIFIED',
  'APPROVED',
  'REJECTED',
  'FORFEITED',
] as const;

export type PodStatus = (typeof POD_STATUSES)[number];

/**
 * Refuses to compile if a `PodStatus` is left unhandled.
 *
 * This is the actual fix for the FORFEITED bug. Answering all seven values was
 * fixing the instance; the *mechanism* was a closing `return` that quietly
 * adopted anything the branches above had not claimed, so an eighth status
 * added to the schema tomorrow would inherit `POD_VERIFIED` exactly as
 * FORFEITED did. With an exhaustive switch, adding to `POD_STATUSES` without
 * handling it is a build error — the mistake becomes impossible rather than
 * merely detected, and it fails at the moment it is made.
 *
 * It throws if reached at runtime, which can only happen if the database
 * grows a value this union has not been told about. That is the right
 * outcome: the transition wiring catches and logs it, so the order keeps its
 * previous status rather than being confidently assigned a wrong one.
 */
function assertNever(value: never, context: string): never {
  throw new Error(`${context}: unhandled value ${JSON.stringify(value)}`);
}

/** Just the facts the ladder needs — no ids, no rows, nothing to fetch. */
export interface LadderFacts {
  indentStage: string;
  failureCause: string | null;
  trip: {
    stage: string;
    podStatus: PodStatus;
    advancePaidPaise: number;
    balancePaidPaise: number;
    lrCode: string | null;
  } | null;
  /** Every configured advance document present and not rejected. */
  advanceDocsUploaded: boolean;
}

/**
 * Which of the ten steps these facts add up to.
 *
 * Order matters throughout — each test assumes the ones above it failed.
 */
export function ladder(facts: LadderFacts): OrderStatus {
  const { indentStage, failureCause, trip, advanceDocsUploaded } = facts;

  if (failureCause && indentStage === 'OPEN') return 'FAILED';
  if (indentStage !== 'TRIP_CREATED') return 'INDENT_CREATED';
  if (!trip) return 'TRIP_GENERATED';

  // Step 3 is conditional by design — FLOWS.md §6 marks the lorry receipt
  // "if needed". An order without one is not stuck at step 2; it simply never
  // had a step 3, so the ladder steps over it.
  if (!trip.lrCode && trip.advancePaidPaise <= 0 && !advanceDocsUploaded) return 'TRIP_GENERATED';
  if (trip.advancePaidPaise <= 0) return advanceDocsUploaded ? 'ADVANCE_DOCS_UPLOADED' : 'LR_ISSUED';
  if (trip.stage === 'OPEN') return 'ADVANCE_PAID';
  if (trip.stage === 'IN_TRANSIT') return 'TRACKING';

  // DELIVERED or CLOSED from here.

  /*
   * Forfeiture is checked first, and before anything else about the proof.
   *
   * This branch used to be missing, and the bug it caused is worth recording:
   * the closing line below caught every remaining `pod_status`, so a
   * FORFEITED order — the worst outcome in the system, where the proof never
   * arrived and the transporter's balance is gone — was stored as
   * `POD_VERIFIED`, step 9 of 10, indistinguishable from a proof somebody had
   * actually checked. It also never closed, so it sat in the open list for
   * ever. It is written for real by the nightly sweep
   * (`jobs.service.ts:135`) and by `payments.service.ts:260`, so this was
   * live, not hypothetical.
   */
  switch (trip.podStatus) {
    case 'FORFEITED':
      return 'POD_FORFEITED';

    case 'PENDING':
      return 'UNLOADED';

  /*
   * A rejected proof is one that has to be sent again, so it goes back to
   * waiting rather than counting as uploaded — the same reasoning as a
   * rejected advance document walking step 4 back to step 3.
   *
   * Latent today: internal-api's `reject()` writes ATTACHED or PENDING and
   * never `REJECTED`. The schema permits it, so the ladder answers for it
   * rather than letting it fall through to the closing line, which is how
   * FORFEITED went wrong.
   */
    case 'REJECTED':
      return 'UNLOADED';

    case 'ATTACHED':
    case 'RECEIVED':
      return 'POD_UPLOADED';

    // The balance is what separates "checked" from "done".
    case 'VERIFIED':
    case 'APPROVED':
      return trip.balancePaidPaise > 0 ? 'BALANCE_RELEASED' : 'POD_VERIFIED';

    default:
      // Unreachable while `PodStatus` matches the schema — and a build error
      // the moment it stops matching, which is the point.
      return assertNever(trip.podStatus, 'ladder: pod_status');
  }
}

/**
 * Whether the configured advance documents count as in.
 *
 * `trip_documents.status` is `PENDING | VERIFIED | REJECTED` — there is no
 * `MISSING` value; the absence of a row is what missing means. REJECTED does
 * not count: that paper has to be sent again, `payments.service.ts`'s advance
 * gate already treats it as unmet, and counting it as done here would put the
 * gate and the ladder in disagreement about the same fact.
 *
 * An empty configured set means nothing gates the advance — vacuously
 * satisfied, not blocked forever.
 */
export function advanceDocsIn(configuredKinds: string[], byKind: Map<string, string>): boolean {
  if (configuredKinds.length === 0) return true;
  return configuredKinds.every((kind) => {
    const status = byKind.get(kind);
    return status === 'PENDING' || status === 'VERIFIED';
  });
}
