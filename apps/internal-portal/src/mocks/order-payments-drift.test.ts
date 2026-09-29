import { describe, it, expect } from 'vitest';
import { orderPaymentsFor } from './index';
import { BRANCHES, db } from './db';
// The real implementation, imported straight out of internal-api — a
// dependency-free module for exactly this reason (see order-ladder-drift.test.ts).
import { buildOrderPayments } from '../../../internal-api/src/modules/orders/order-payments';

/**
 * Drift guard: the fixture's order-payments block must agree with the API's.
 *
 * Only the money arithmetic is compared. The payment *lines* differ on purpose:
 * seeded trips have no ledger rows, so the fixture stands in a transfer
 * reference where the real endpoint reads the recorded UTR.
 */
const trips = db.indents
  .map((indent: any) => ({ indent, trip: db.trips.find((t: any) => t.indentCode === indent.code) ?? null }))
  .filter(({ indent }) => typeof indent.sellRatePaise === 'number');

const viaApi = (indent: any, trip: any, canSeeMargin: boolean) =>
  buildOrderPayments({
    sourcingRatePaise: indent.buyRatePaise ?? null,
    placementRatePaise: indent.sellRatePaise,
    charges: (trip?.charges ?? []).map((c: any) => ({ chargeType: c.chargeType, costPaise: c.costAmountPaise })),
    payments: [],
    canSeeMargin,
  });

describe('order payments — fixture agrees with the API', () => {
  it('has orders to compare, some with charges and some with a sourcing rate', () => {
    expect(trips.length).toBeGreaterThan(0);
    expect(trips.some(({ trip }) => (trip?.charges ?? []).length > 0)).toBe(true);
    expect(trips.some(({ indent }) => indent.buyRatePaise != null)).toBe(true);
  });

  it('gives the same rates, charge buckets and margin for every order (FINANCE sees all)', () => {
    for (const { indent, trip } of trips) {
      const mock: any = orderPaymentsFor(indent, trip, 'FINANCE', null);
      const api = viaApi(indent, trip, true);
      for (const key of [
        'sourcingRatePaise',
        'placementRatePaise',
        'loadingPaise',
        'unloadingPaise',
        'otherChargesPaise',
        'marginPaise',
        'marginPct',
      ] as const) {
        expect(mock[key], `${indent.code}.${key}`).toEqual(api[key]);
      }
    }
  });

  it('withholds margin from a role with no P&L access, and keeps the rates', () => {
    const { indent, trip } = trips.find(({ indent }) => indent.buyRatePaise != null)!;
    const mock: any = orderPaymentsFor(indent, trip, 'COMPLIANCE', null);
    const api = viaApi(indent, trip, false);
    expect(mock.marginPaise).toBeNull();
    expect(mock.marginPct).toBeNull();
    expect(mock.sourcingRatePaise).toBe(api.sourcingRatePaise);
    expect(mock.placementRatePaise).toBe(api.placementRatePaise);
  });

  it('shows margin to an own-branch role only for its own branch', () => {
    const { indent, trip } = trips.find(({ indent }) => indent.buyRatePaise != null)!;
    const own = BRANCHES.find((b) => b.name === indent.branchName);
    const other = BRANCHES.find((b) => b.name !== indent.branchName)!;
    expect(own).toBeDefined();
    // With no branch scope at all, pnl.view_own cannot match anything.
    expect((orderPaymentsFor(indent, trip, 'OPS', null) as any).marginPaise).toBeNull();
    expect((orderPaymentsFor(indent, trip, 'OPS', other.code) as any).marginPaise).toBeNull();
    expect((orderPaymentsFor(indent, trip, 'OPS', own!.code) as any).marginPaise).not.toBeNull();
  });
});
