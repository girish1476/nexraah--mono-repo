import { describe, expect, it } from 'vitest';
import { tripCost } from './reports.service';

describe("a trip's cost on the business snapshot", () => {
  it('adds the rate and the charges as numbers, even when the driver hands them over as text', () => {
    // sum() of a bigint is numeric; node-postgres gives numeric as a string.
    expect(tripCost({ buyRatePaise: 4472000, chargeCostPaise: '0' })).toBe(4472000);
    expect(tripCost({ buyRatePaise: 4472000, chargeCostPaise: '150000' })).toBe(4622000);
    expect(tripCost({ buyRatePaise: 4472000, chargeCostPaise: null })).toBe(4472000);
  });
});
