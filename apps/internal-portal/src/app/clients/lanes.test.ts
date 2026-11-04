import { describe, expect, it } from 'vitest';
import { branchForCity, liveLanes } from './lanes';
import { RateCardLane } from './types';

const lane = (id: string, validFrom: string, validTo: string | null, route = 'Pune'): RateCardLane =>
  ({
    id,
    rfqLaneId: `rfq-${id}`,
    origin: 'Mumbai',
    destination: route,
    truckType: '32ft',
    ratePaise: 100,
    transitDays: 2,
    reportingRule: 'SAME_DAY',
    validFrom,
    validTo: validTo as string,
    supplySource: null,
    supplySourceLabel: null,
    supplyRemarks: null,
  }) as RateCardLane;

describe('liveLanes', () => {
  it('drops a lane that has already ended, keeping its successor', () => {
    const rows = [lane('old', '2026-01-01', '2026-08-31'), lane('new', '2026-09-01', null)];
    expect(liveLanes(rows, '2026-09-26').map((l) => l.lane.id)).toEqual(['new']);
  });

  it('keeps a lane that is being replaced later, and says when', () => {
    const rows = [lane('old', '2026-01-01', '2026-09-30'), lane('new', '2026-10-01', null)];
    const out = liveLanes(rows, '2026-09-26');
    expect(out.map((l) => [l.lane.id, l.replacedFrom])).toEqual([
      ['old', '2026-10-01'],
      ['new', null],
    ]);
  });

  it('does not treat a different route as a successor', () => {
    const rows = [lane('a', '2026-01-01', null, 'Pune'), lane('b', '2026-09-01', null, 'Nagpur')];
    expect(liveLanes(rows, '2026-09-26').every((l) => l.replacedFrom === null)).toBe(true);
  });
});

describe('branchForCity', () => {
  const branches = [
    { id: 'nsk', city: 'Nashik' },
    { id: 'pun', city: 'Pune' },
    { id: 'pun2', city: 'pune ' },
    { id: 'vzg', city: 'Visakhapatnam', servedCities: ['Achuthapuram'] },
  ];
  it('finds the branch that lists the town under "Also serves"', () => {
    expect(branchForCity(branches, 'achuthapuram')?.id).toBe('vzg');
  });
  it('finds the one branch in the from city, whatever the case', () => {
    expect(branchForCity(branches, ' nashik')?.id).toBe('nsk');
  });
  it('decides nothing where no branch is in the city — the lane must name one', () => {
    expect(branchForCity(branches, 'Mundra')).toBeNull();
    expect(branchForCity(branches, '')).toBeNull();
  });
  it('decides nothing where two branches share the city', () => {
    expect(branchForCity(branches, 'Pune')).toBeNull();
  });
});
