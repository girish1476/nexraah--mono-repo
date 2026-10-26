import { describe, expect, it } from 'vitest';
import { checkQuoteCorrection, checkQuoteRemoval, planLoadCorrection, type LoadNow } from './corrections';

const load = (over: Partial<LoadNow> = {}): LoadNow => ({
  stage: 'OPEN',
  material: 'Vitrified tiles',
  weightKg: 30_000,
  truckType: '32 ft SXL',
  pickupDate: '2026-10-12',
  sellRatePaise: 6_420_000,
  pickupAddress: null,
  dropAddress: 'Plot 12, SIPCOT, Hosur',
  ...over,
});

const refusal = (r: { ok: boolean; refusal?: { code: string } }) => (r.ok ? null : r.refusal!.code);

describe('correcting a load request', () => {
  it('writes only what changed, in the units the tables keep, and says what it used to be', () => {
    const plan = planLoadCorrection(load(), { weightTn: 32, sellRatePaise: 6_470_000, material: ' Vitrified  tiles (corrected) ' }, false);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.indent).toEqual({ material: 'Vitrified tiles (corrected)', weight_kg: 32_000, sell_rate: 6_470_000 });
    // The trip carries its own copy of the weight; it has no freight or material of its own.
    expect(plan.trip).toEqual({ weight_kg: 32_000 });
    expect(plan.lines).toEqual([
      'Material: Vitrified tiles → Vitrified tiles (corrected)',
      'Weight: 30 MT → 32 MT',
      'Freight (sell): ₹64,200 → ₹64,700',
    ]);
  });

  it('a truck type goes to the trip as well; an address can be filled in or cleared', () => {
    const plan = planLoadCorrection(load(), { truckType: '20 ft SXL', pickupAddress: 'Gate 3, MIDC Ambad', dropAddress: '  ' }, false);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.indent).toEqual({ truck_type: '20 ft SXL', pickup_address: 'Gate 3, MIDC Ambad', drop_address: null });
    expect(plan.trip).toEqual({ vehicle_type: '20 ft SXL' });
    expect(plan.lines).toContain('Unloading address: Plot 12, SIPCOT, Hosur → —');
  });

  it('sending back what is already there changes nothing', () => {
    expect(refusal(planLoadCorrection(load(), { weightTn: 30, material: 'Vitrified tiles', pickupDate: '2026-10-12' }, false))).toBe('NOTHING_CHANGED');
    expect(refusal(planLoadCorrection(load(), {}, false))).toBe('NOTHING_CHANGED');
  });

  it('refuses a value that is not one', () => {
    expect(refusal(planLoadCorrection(load(), { weightTn: 0 }, false))).toBe('VALIDATION_ERROR');
    expect(refusal(planLoadCorrection(load(), { weightTn: 250 }, false))).toBe('VALIDATION_ERROR');
    expect(refusal(planLoadCorrection(load(), { sellRatePaise: 12.5 }, false))).toBe('VALIDATION_ERROR');
    expect(refusal(planLoadCorrection(load(), { material: 'x' }, false))).toBe('VALIDATION_ERROR');
    expect(refusal(planLoadCorrection(load(), { pickupDate: 'tomorrow' }, false))).toBe('VALIDATION_ERROR');
  });

  it('a cancelled load has nothing to correct', () => {
    expect(refusal(planLoadCorrection(load({ stage: 'CANCELLED' }), { weightTn: 32 }, false))).toBe('CANCELLED');
  });

  it('once invoiced, the weight and the freight are fixed — the rest can still be put right', () => {
    expect(refusal(planLoadCorrection(load(), { weightTn: 32 }, true))).toBe('ALREADY_INVOICED');
    expect(refusal(planLoadCorrection(load(), { sellRatePaise: 6_470_000 }, true))).toBe('ALREADY_INVOICED');
    expect(planLoadCorrection(load(), { material: 'Ceramic tiles', weightTn: 30 }, true).ok).toBe(true);
  });
});

describe('correcting a quote', () => {
  it('before the award the amount is simply put right', () => {
    expect(checkQuoteCorrection({ status: 'SUBMITTED', amountPaise: 4_400_000 }, 4_300_000, null).ok).toBe(true);
    expect(refusal(checkQuoteCorrection({ status: 'SUBMITTED', amountPaise: 4_400_000 }, 4_400_000, null))).toBe('NOTHING_CHANGED');
    expect(refusal(checkQuoteCorrection({ status: 'SUBMITTED', amountPaise: 4_400_000 }, 0, null))).toBe('VALIDATION_ERROR');
    expect(refusal(checkQuoteCorrection({ status: 'REJECTED', amountPaise: 4_400_000 }, 4_300_000, null))).toBe('QUOTE_CLOSED');
  });

  it('after the award it cannot go below an advance already paid, nor move once the balance has gone', () => {
    const awarded = { status: 'ACCEPTED', amountPaise: 4_350_000 };
    expect(checkQuoteCorrection(awarded, 4_200_000, { advancePaidPaise: 1_740_000, balancePaidPaise: 0 }).ok).toBe(true);
    expect(refusal(checkQuoteCorrection(awarded, 1_500_000, { advancePaidPaise: 1_740_000, balancePaidPaise: 0 }))).toBe('BELOW_ADVANCE');
    expect(refusal(checkQuoteCorrection(awarded, 4_200_000, { advancePaidPaise: 1_740_000, balancePaidPaise: 2_610_000 }))).toBe('BALANCE_PAID');
    // Awarded, but no trip yet: nothing has been paid, so nothing holds it.
    expect(checkQuoteCorrection(awarded, 4_200_000, null).ok).toBe(true);
  });

  it('only a quote not yet awarded can be removed', () => {
    expect(checkQuoteRemoval('SUBMITTED', 'OPEN').ok).toBe(true);
    expect(refusal(checkQuoteRemoval('ACCEPTED', 'VENDOR_ASSIGNED'))).toBe('QUOTE_CLOSED');
    expect(refusal(checkQuoteRemoval('SUBMITTED', 'VENDOR_ASSIGNED'))).toBe('QUOTE_CLOSED');
    expect(refusal(checkQuoteRemoval('REJECTED', 'OPEN'))).toBe('QUOTE_CLOSED');
  });
});
