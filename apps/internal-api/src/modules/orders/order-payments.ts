/**
 * The money on one order, worked out in one place.
 *
 * Pure and dependency-free, for the same reason `order-ladder.ts` is: the
 * portal's fixture adapter has to answer the same question, and two copies of
 * a margin rule drift silently. A file with no imports can be pulled into the
 * portal's test suite and run against both.
 *
 * The margin rule is BR-35, exactly as `PnlService` applies it — revenue is
 * the client's accepted rate, cost is the rate the vehicle was sourced at plus
 * every charge line's *cost* (never what was billed on). It is deliberately the
 * same sum, so an order's margin here and the same trip inside the Profit and
 * loss page can never disagree.
 */

/** A payment as stored, reduced to what the order page shows. */
export interface OrderPaymentRow {
  kind: 'ADVANCE' | 'BALANCE';
  grossPaise: number;
  penaltyPaise: number;
  deductionPaise: number;
  netPaise: number;
  mode: string;
  utr: string;
  valueDate: string;
  releasedAt: string;
  releasedByName: string | null;
}

export interface OrderChargeRow {
  chargeType: string;
  costPaise: number;
}

export interface OrderPayments {
  /** What the transporter's vehicle was sourced at — null until one is awarded. */
  sourcingRatePaise: number | null;
  /** What the client accepted for the load. */
  placementRatePaise: number;
  /** Loading, unloading and everything else captured against the trip, as cost. */
  loadingPaise: number;
  unloadingPaise: number;
  otherChargesPaise: number;
  /**
   * Placement rate less sourcing rate less every charge. Null when there is no
   * sourcing rate to subtract, or when the caller may not see margin.
   */
  marginPaise: number | null;
  /** Margin as a share of the placement rate, one decimal place. Null with `marginPaise`. */
  marginPct: number | null;
  advance: OrderPaymentLine | null;
  balance: OrderPaymentLine | null;
}

export type OrderPaymentLine = Omit<OrderPaymentRow, 'kind'>;

const round1 = (n: number) => Math.round(n * 10) / 10;

function latest(rows: OrderPaymentRow[], kind: OrderPaymentRow['kind']): OrderPaymentLine | null {
  const match = rows
    .filter((r) => r.kind === kind)
    .sort((a, b) => String(b.releasedAt).localeCompare(String(a.releasedAt)))[0];
  if (!match) return null;
  const { kind: _kind, ...line } = match;
  return line;
}

export function buildOrderPayments(input: {
  sourcingRatePaise: number | null;
  placementRatePaise: number;
  charges: OrderChargeRow[];
  payments: OrderPaymentRow[];
  /** `pnl.view_all`, or `pnl.view_own` on an order in the caller's own branch. */
  canSeeMargin: boolean;
}): OrderPayments {
  let loadingPaise = 0;
  let unloadingPaise = 0;
  let otherChargesPaise = 0;
  for (const c of input.charges) {
    if (c.chargeType === 'LOADING') loadingPaise += c.costPaise;
    else if (c.chargeType === 'UNLOADING') unloadingPaise += c.costPaise;
    else otherChargesPaise += c.costPaise; // LABOUR, HALT, DETENTION, OTHER
  }

  const marginPaise =
    input.canSeeMargin && input.sourcingRatePaise !== null
      ? input.placementRatePaise - input.sourcingRatePaise - loadingPaise - unloadingPaise - otherChargesPaise
      : null;
  const marginPct =
    marginPaise !== null && input.placementRatePaise > 0
      ? round1((marginPaise / input.placementRatePaise) * 100)
      : null;

  return {
    sourcingRatePaise: input.sourcingRatePaise,
    placementRatePaise: input.placementRatePaise,
    loadingPaise,
    unloadingPaise,
    otherChargesPaise,
    marginPaise,
    marginPct,
    advance: latest(input.payments, 'ADVANCE'),
    balance: latest(input.payments, 'BALANCE'),
  };
}
