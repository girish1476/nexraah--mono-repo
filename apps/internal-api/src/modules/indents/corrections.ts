/**
 * Putting a mistake right on a load request or a quote — the rules, pure and
 * dependency-free (same shape as `rate-cross-check.ts`).
 *
 * Something typed wrongly used to be permanent: the only way out was to cancel
 * the load and raise it again. These are the corrections. Each takes effect at
 * once and carries a reason, which is written to the order's comments, so the
 * record shows what it used to say.
 *
 * The console's fixture adapter (`apps/internal-portal/src/mocks/index.ts`)
 * makes the same refusals with the same codes and words; if one changes, change
 * both.
 */

export interface Refusal {
  status: number;
  code: string;
  message: string;
}

const refuse = (status: number, code: string, message: string): { ok: false; refusal: Refusal } => ({
  ok: false,
  refusal: { status, code, message },
});

export const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString('en-IN')}`;

/* ---------------------------------------------------------- the load -- */

/** The load request as it stands — the parts that can be corrected. */
export interface LoadNow {
  stage: string;
  material: string;
  weightKg: number;
  truckType: string;
  pickupDate: string;
  sellRatePaise: number;
  pickupAddress: string | null;
  dropAddress: string | null;
}

/** What was sent. Every part is optional: only what is named is changed. */
export interface LoadCorrection {
  material?: string;
  weightTn?: number;
  truckType?: string;
  pickupDate?: string;
  sellRatePaise?: number;
  pickupAddress?: string | null;
  dropAddress?: string | null;
}

export type LoadPlan =
  | {
      ok: true;
      /** Columns to write on `indents`. */
      indent: Record<string, string | number | null>;
      /** Columns to write on the load's trip, where it has one. */
      trip: Record<string, string | number | null>;
      /** "Weight: 30 MT → 32 MT" — one for each thing changed, for the order's comments. */
      lines: string[];
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }
  | { ok: false; refusal: Refusal };

const tidy = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const day = (v: unknown) => String(v ?? '').slice(0, 10);
const tonnes = (kg: number) => `${kg / 1000} MT`;
const shown = (v: string | null) => (v === null || v === '' ? '—' : v);

/**
 * `invoiced` — the client has a live invoice for this load. Its weight and
 * freight are on that bill and cannot move under it; everything else still can.
 */
export function planLoadCorrection(now: LoadNow, input: LoadCorrection, invoiced: boolean): LoadPlan {
  if (now.stage === 'CANCELLED') return refuse(409, 'CANCELLED', 'This load was cancelled; there is nothing to correct.');

  const indent: Record<string, string | number | null> = {};
  const trip: Record<string, string | number | null> = {};
  const lines: string[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const note = (key: string, label: string, was: string, is: string, wasRaw: unknown, isRaw: unknown) => {
    lines.push(`${label}: ${was} → ${is}`);
    before[key] = wasRaw;
    after[key] = isRaw;
  };

  if (input.material !== undefined) {
    const v = tidy(input.material);
    if (v.length < 2) return refuse(400, 'VALIDATION_ERROR', 'Enter the material.');
    if (v !== now.material) {
      indent.material = v;
      note('material', 'Material', shown(now.material), v, now.material, v);
    }
  }
  if (input.truckType !== undefined) {
    const v = tidy(input.truckType);
    if (v.length < 2) return refuse(400, 'VALIDATION_ERROR', 'Enter the truck type.');
    if (v !== now.truckType) {
      indent.truck_type = v;
      trip.vehicle_type = v;
      note('truckType', 'Truck type', shown(now.truckType), v, now.truckType, v);
    }
  }
  for (const [key, column, label] of [
    ['pickupAddress', 'pickup_address', 'Loading address'],
    ['dropAddress', 'drop_address', 'Unloading address'],
  ] as const) {
    if (input[key] === undefined) continue;
    const v = String(input[key] ?? '').trim() || null;
    if (v !== (now[key] ?? null)) {
      indent[column] = v;
      note(key, label, shown(now[key]), shown(v), now[key], v);
    }
  }
  if (input.pickupDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(input.pickupDate)) || Number.isNaN(Date.parse(day(input.pickupDate)))) {
      return refuse(400, 'VALIDATION_ERROR', 'Enter the pickup date.');
    }
    const v = day(input.pickupDate);
    if (v !== day(now.pickupDate)) {
      indent.pickup_date = v;
      note('pickupDate', 'Pickup date', day(now.pickupDate), v, day(now.pickupDate), v);
    }
  }

  let billedFigureMoved = false;
  if (input.weightTn !== undefined) {
    const w = Number(input.weightTn);
    if (!(w > 0) || w > 200) return refuse(400, 'VALIDATION_ERROR', 'Enter the weight in tonnes.');
    const kg = Math.round(w * 1000);
    if (kg !== now.weightKg) {
      indent.weight_kg = kg;
      trip.weight_kg = kg;
      note('weightTn', 'Weight', tonnes(now.weightKg), tonnes(kg), now.weightKg / 1000, kg / 1000);
      billedFigureMoved = true;
    }
  }
  if (input.sellRatePaise !== undefined) {
    const r = Number(input.sellRatePaise);
    if (!Number.isInteger(r) || r < 1) return refuse(400, 'VALIDATION_ERROR', 'Enter the freight as a positive amount.');
    if (r !== now.sellRatePaise) {
      indent.sell_rate = r;
      note('sellRatePaise', 'Freight (sell)', rupees(now.sellRatePaise), rupees(r), now.sellRatePaise, r);
      billedFigureMoved = true;
    }
  }

  // Once the client is billed, the figures on the bill cannot move under it.
  if (invoiced && billedFigureMoved) {
    return refuse(
      409,
      'ALREADY_INVOICED',
      'The client has been invoiced for this load, so its weight and freight can no longer be changed here. Cancel the invoice first.',
    );
  }
  if (lines.length === 0) return refuse(409, 'NOTHING_CHANGED', 'Nothing was changed.');
  return { ok: true, indent, trip, lines, before, after };
}

/* --------------------------------------------------------- a quote -- */

export type Check = { ok: true } | { ok: false; refusal: Refusal };

/** The load's trip, where an awarded quote already has money paid against it. */
export interface PaidSoFar {
  advancePaidPaise: number;
  balancePaidPaise: number;
}

/**
 * A quote's amount put right. Before the award it is just a figure; after it,
 * it is the transporter's rate on the load and the trip — so it cannot go below
 * an advance already paid, and cannot move at all once the balance has gone.
 */
export function checkQuoteCorrection(
  quote: { status: string; amountPaise: number },
  amountPaise: number,
  paid: PaidSoFar | null,
): Check {
  if (!Number.isInteger(amountPaise) || amountPaise < 1) {
    return refuse(400, 'VALIDATION_ERROR', 'Enter the quote as a positive amount.');
  }
  if (!['SUBMITTED', 'ACCEPTED'].includes(quote.status)) {
    return refuse(409, 'QUOTE_CLOSED', `This quote is ${quote.status.toLowerCase()} and can no longer be changed.`);
  }
  if (amountPaise === quote.amountPaise) return refuse(409, 'NOTHING_CHANGED', 'That is the amount already on this quote.');
  if (quote.status === 'ACCEPTED' && paid) {
    if (paid.balancePaidPaise > 0) {
      return refuse(
        409,
        'BALANCE_PAID',
        'The transporter has been paid in full for this load, so the awarded rate can no longer be changed.',
      );
    }
    if (paid.advancePaidPaise > amountPaise) {
      return refuse(
        409,
        'BELOW_ADVANCE',
        `An advance of ${rupees(paid.advancePaidPaise)} has already been paid; the rate cannot go below it.`,
      );
    }
  }
  return { ok: true };
}

/** A quote entered by mistake is removed; an awarded one is corrected instead. */
export function checkQuoteRemoval(quoteStatus: string, indentStage: string): Check {
  if (quoteStatus !== 'SUBMITTED' || indentStage !== 'OPEN') {
    return refuse(
      409,
      'QUOTE_CLOSED',
      'Only a quote that has not been awarded can be removed. To change an awarded rate, correct the amount instead.',
    );
  }
  return { ok: true };
}
