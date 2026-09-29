import { describe, it, expect } from 'vitest';
import { buildOrderPayments, type OrderPaymentRow } from './order-payments';

/**
 * The order page's Payments section.
 *
 * The margin rule is the one the Profit and loss page applies (BR-35): the
 * client's accepted rate, less the rate the vehicle was sourced at, less every
 * charge's cost. If this drifts from `PnlService`, an order and the P&L row it
 * belongs to would quote two different margins for the same load.
 */
const base = { sourcingRatePaise: 8_000_000, placementRatePaise: 10_000_000, charges: [], payments: [], canSeeMargin: true };

const pay = (over: Partial<OrderPaymentRow>): OrderPaymentRow => ({
  kind: 'ADVANCE',
  grossPaise: 3_200_000,
  penaltyPaise: 0,
  deductionPaise: 0,
  netPaise: 3_200_000,
  mode: 'NEFT',
  utr: 'UTR0001',
  valueDate: '2026-09-01',
  releasedAt: '2026-09-01T10:00:00Z',
  releasedByName: 'Finance user',
  ...over,
});

describe('buildOrderPayments', () => {
  it('margin is placement rate less sourcing rate less every charge cost', () => {
    const r = buildOrderPayments({
      ...base,
      charges: [
        { chargeType: 'LOADING', costPaise: 100_000 },
        { chargeType: 'UNLOADING', costPaise: 150_000 },
        { chargeType: 'DETENTION', costPaise: 50_000 },
      ],
    });
    expect(r.loadingPaise).toBe(100_000);
    expect(r.unloadingPaise).toBe(150_000);
    expect(r.otherChargesPaise).toBe(50_000);
    expect(r.marginPaise).toBe(10_000_000 - 8_000_000 - 300_000);
    expect(r.marginPct).toBe(17);
  });

  it('folds labour, halt and other into other charges, as the P&L does', () => {
    const r = buildOrderPayments({
      ...base,
      charges: [
        { chargeType: 'LABOUR', costPaise: 1 },
        { chargeType: 'HALT', costPaise: 2 },
        { chargeType: 'OTHER', costPaise: 4 },
      ],
    });
    expect(r.otherChargesPaise).toBe(7);
  });

  it('has no margin until a vehicle is sourced', () => {
    const r = buildOrderPayments({ ...base, sourcingRatePaise: null });
    expect(r.sourcingRatePaise).toBeNull();
    expect(r.marginPaise).toBeNull();
    expect(r.marginPct).toBeNull();
  });

  it('withholds the margin, but not the rates, from a caller who may not see it', () => {
    const r = buildOrderPayments({ ...base, canSeeMargin: false });
    expect(r.marginPaise).toBeNull();
    expect(r.marginPct).toBeNull();
    expect(r.sourcingRatePaise).toBe(8_000_000);
    expect(r.placementRatePaise).toBe(10_000_000);
  });

  it('reports a loss as a negative margin', () => {
    const r = buildOrderPayments({ ...base, sourcingRatePaise: 11_000_000 });
    expect(r.marginPaise).toBe(-1_000_000);
    expect(r.marginPct).toBe(-10);
  });

  it('gives the UTR of each payment, and null for one not yet made', () => {
    const r = buildOrderPayments({
      ...base,
      payments: [pay({}), pay({ kind: 'BALANCE', utr: 'UTR0002', netPaise: 4_000_000, grossPaise: 4_500_000, penaltyPaise: 500_000 })],
    });
    expect(r.advance?.utr).toBe('UTR0001');
    expect(r.balance?.utr).toBe('UTR0002');
    expect(r.balance?.penaltyPaise).toBe(500_000);
    expect(buildOrderPayments({ ...base, payments: [pay({})] }).balance).toBeNull();
  });

  it('shows the most recent payment when a kind has more than one', () => {
    const r = buildOrderPayments({
      ...base,
      payments: [pay({ utr: 'OLD', releasedAt: '2026-09-01T10:00:00Z' }), pay({ utr: 'NEW', releasedAt: '2026-09-02T10:00:00Z' })],
    });
    expect(r.advance?.utr).toBe('NEW');
  });
});
