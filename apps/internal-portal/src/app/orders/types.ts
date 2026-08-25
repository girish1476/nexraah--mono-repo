/**
 * An order is a real record now — `GET /orders`, backed by the `orders` table.
 *
 * It used to be a client-side view stitched together from `/indents`,
 * `/trips` and `/invoices` on every load, with the ten-step ladder run in the
 * browser. That is why this file's shapes changed: an order has its own
 * `ORD-` number rather than borrowing the indent's code, a `stepNo` the
 * server computed once, and a recorded `events` history in place of
 * milestones the screen worked out for itself.
 *
 * Still read-only, and deliberately so. There is no endpoint to set a status:
 * an order's step is a consequence of what happened to its indent, trip,
 * documents and payments, so movement happens by doing the underlying thing.
 * Every action still lives on the indent, trip, POD or invoice page.
 */

/**
 * The ten stages, fixed by the user's own notes ("OMS missed in the main
 * details"): Indent Creation, Trip generated, LR (if needed), Advance docs
 * uploaded, Advance paid, Tracking, Unloaded, POD uploaded, POD verified,
 * Balance released. FAILED is not one of the ten — it is the exception
 * branch for an indent the nightly placement job couldn't place a vehicle
 * against, surfaced so it doesn't just look stuck at "Indent created".
 */
export type OrderStatus =
  | 'FAILED'
  /** Proof never arrived and the balance is gone. Terminal, outside the ten. */
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

/**
 * The step, in the words the console uses everywhere else.
 *
 * These deliberately match `JOURNEY_STEPS` in `lib/ui.tsx` one for one. They
 * did not before, and it showed: the ten-dot rail in a list row called step 1
 * "Load requested" while the pill on that same order's detail page called it
 * "Indent created" — two vocabularies for one fact, which is exactly the kind
 * of thing that makes people distrust a screen. The trade word is still
 * available on the journey rail's tooltip for anyone who wants it.
 */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  FAILED: 'Could not place',
  POD_FORFEITED: 'Balance forfeited',
  INDENT_CREATED: 'Load requested',
  TRIP_GENERATED: 'Vehicle booked',
  LR_ISSUED: 'Lorry receipt issued',
  ADVANCE_DOCS_UPLOADED: 'Advance papers in',
  ADVANCE_PAID: 'Advance paid',
  TRACKING: 'On the road',
  UNLOADED: 'Unloaded',
  POD_UPLOADED: 'Delivery proof in',
  POD_VERIFIED: 'Proof checked',
  BALANCE_RELEASED: 'Final payment out',
};

export const ORDER_STATUS_TONE: Record<OrderStatus, 'mint' | 'flag' | 'red' | 'blue' | 'grey'> = {
  FAILED: 'red',
  POD_FORFEITED: 'red',
  INDENT_CREATED: 'grey',
  TRIP_GENERATED: 'blue',
  LR_ISSUED: 'blue',
  ADVANCE_DOCS_UPLOADED: 'flag',
  ADVANCE_PAID: 'blue',
  TRACKING: 'blue',
  UNLOADED: 'blue',
  POD_UPLOADED: 'flag',
  POD_VERIFIED: 'blue',
  BALANCE_RELEASED: 'mint',
};

/** Plain-language order of the ten stages, for rendering a step tracker. */
export const ORDER_STATUS_SEQUENCE: OrderStatus[] = [
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

/**
 * Ten stages is the right vocabulary for one order and the wrong one for a
 * list of four hundred — nobody triages by picking through ten tabs. These
 * five are the phases an operator actually works in, and they are what the
 * list is grouped by.
 *
 * `NEEDS_YOU` deliberately cuts across the sequence rather than sitting inside
 * it: a placement failure at step 1 and an unverified proof of delivery at
 * step 8 are both somebody's job this morning, and burying them in "Placing"
 * and "Delivered" is how they get missed.
 */
export type OrderPhase = 'NEEDS_YOU' | 'PLACING' | 'MOVING' | 'DELIVERED' | 'SETTLED';

export const ORDER_PHASE_LABEL: Record<OrderPhase, string> = {
  NEEDS_YOU: 'Needs you',
  PLACING: 'Finding a vehicle',
  MOVING: 'On the move',
  DELIVERED: 'Delivered',
  SETTLED: 'Paid and closed',
};

/**
 * One glyph per phase, so the tab strip can be read across the room. Paired
 * with the label every time — the emoji is never the only thing naming a tab.
 */
export const ORDER_PHASE_EMOJI: Record<OrderPhase, string> = {
  NEEDS_YOU: '🙋',
  PLACING: '🔎',
  MOVING: '🛣️',
  DELIVERED: '📦',
  SETTLED: '✅',
};

export const ORDER_PHASE_SEQUENCE: OrderPhase[] = [
  'NEEDS_YOU',
  'PLACING',
  'MOVING',
  'DELIVERED',
  'SETTLED',
];

/** The three states that are waiting on a person, not on a truck. */
const AWAITING_A_PERSON: OrderStatus[] = ['FAILED', 'ADVANCE_DOCS_UPLOADED', 'POD_UPLOADED'];

export function phaseFor(status: OrderStatus): OrderPhase {
  if (AWAITING_A_PERSON.includes(status)) return 'NEEDS_YOU';
  // Closed, though not happily — nobody can act on it, so it does not belong
  // in a work queue. Its red tone and "Balance forfeited" label carry the bad
  // news; burying it in a phase called "Needs you" would be worse, because
  // there is nothing anyone can do about it now.
  if (status === 'BALANCE_RELEASED' || status === 'POD_FORFEITED') return 'SETTLED';
  if (status === 'INDENT_CREATED' || status === 'TRIP_GENERATED') return 'PLACING';
  if (status === 'UNLOADED' || status === 'POD_VERIFIED') return 'DELIVERED';
  return 'MOVING';
}

/** 1-based position in the ten. `FAILED` reports 1 — it never left placement. */
export function stepFor(status: OrderStatus): number {
  // Matches `stepNoFor` in the API's order-ladder.ts: a forfeited order
  // reached the proof stage and stops there, so nine of ten is the truth.
  if (status === 'POD_FORFEITED') return 9;
  const i = ORDER_STATUS_SEQUENCE.indexOf(status);
  return i === -1 ? 1 : i + 1;
}

/**
 * What happens next, and whose desk it is on. A status names where a shipment
 * *is*; this names what would move it — which is the question an operator
 * actually opens this screen with.
 */
export const ORDER_NEXT_ACTION: Record<OrderStatus, { action: string; owner: string }> = {
  FAILED: { action: 'Re-quote — no vehicle placed', owner: 'Operations' },
  POD_FORFEITED: {
    action: 'Nothing — proof never arrived, the balance is forfeited',
    owner: '',
  },
  INDENT_CREATED: { action: 'Award a transporter', owner: 'Operations' },
  TRIP_GENERATED: { action: 'Issue the Lorry Receipt', owner: 'Operations' },
  LR_ISSUED: { action: 'Collect the advance documents', owner: 'Operations' },
  ADVANCE_DOCS_UPLOADED: { action: 'Verify documents, then release advance', owner: 'Compliance' },
  ADVANCE_PAID: { action: 'Track the vehicle to delivery', owner: 'Operations' },
  TRACKING: { action: 'Track the vehicle to delivery', owner: 'Operations' },
  UNLOADED: { action: 'Waiting for the signed paper to reach the branch', owner: 'Transporter' },
  POD_UPLOADED: { action: 'Verify proof of delivery', owner: 'Compliance' },
  POD_VERIFIED: { action: 'Release the balance', owner: 'Finance' },
  BALANCE_RELEASED: { action: 'Nothing — this one is done', owner: '' },
};

export interface OrderListRow {
  id: string;
  /** The stable `ORD-` number. Survives the indent it grew out of. */
  orderNo: string;
  indentId: string;
  indentCode: string;
  clientName: string;
  lane: string;
  pickupDate: string;
  sellRatePaise: number;
  branchName: string;
  status: OrderStatus;
  /** 1..10, computed once on the server so it can never disagree with `status`. */
  stepNo: number;
  tripId: string | null;
  tripCode: string | null;
  invoiceCode: string | null;
  failureCause: string | null;
  closedAt: string | null;
}

/** One page of orders, plus the total it was taken from. */
export interface OrderListResponse {
  rows: OrderListRow[];
  total: number;
  limit: number;
  offset: number;
}

/** How many orders sit on each step — the phase tabs read this. */
export type OrderCounts = Partial<Record<OrderStatus, number>>;

/**
 * One entry into a step, as recorded.
 *
 * `actorName` is null when the system did it — a nightly sweep, a tracking
 * ping — which is a real answer rather than a missing one, and better than
 * attributing it to whoever happened to load the screen.
 */
export interface OrderEvent {
  id: string;
  status: OrderStatus;
  stepNo: number;
  actorName: string | null;
  note: string | null;
  at: string;
}

export interface OrderDetail extends OrderListRow {
  fromCity: string;
  toCity: string;
  material: string;
  weightTn: number;
  truckType: string;
  vendorName: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  buyRatePaise: number | null;
  advancePaidPaise: number;
  balancePaidPaise: number;
  /** Recorded step history, oldest first. Replaces the old computed milestones. */
  events: OrderEvent[];
}
