import { describe, it, expect } from 'vitest';
import { activeFilterCount, emptyFilters, matchesAny, squash } from './list-filters';

describe('squash', () => {
  it('makes every spelling of a truck number the same', () => {
    expect(squash('MH 12 AB 1234')).toBe('mh12ab1234');
    expect(squash('mh-12-ab-1234')).toBe('mh12ab1234');
    expect(squash(null)).toBe('');
  });
});

describe('matchesAny', () => {
  it('matches everything when nothing is typed', () => {
    expect(matchesAny('', 'anything')).toBe(true);
    expect(matchesAny('   ', null)).toBe(true);
  });

  it('finds a partial, case-insensitive hit in any field', () => {
    expect(matchesAny('rathod', 'Berger Paints', 'Rathod Roadlines')).toBe(true);
    expect(matchesAny('mh12ab', 'MH 12 AB 1234')).toBe(true);
    expect(matchesAny('88214', 'LR-88214')).toBe(true);
  });

  it('does not match a missing field or a different value', () => {
    expect(matchesAny('pune', null, undefined, 'Mumbai')).toBe(false);
  });

  it('matches numbers as text', () => {
    expect(matchesAny('12', 120881)).toBe(true);
  });
});

describe('filter values', () => {
  const fields = [
    { kind: 'text' as const, key: 'a', label: 'A' },
    { kind: 'select' as const, key: 'b', label: 'B', options: [] },
  ];
  it('starts empty and counts only the filled ones', () => {
    const values = emptyFilters(fields);
    expect(values).toEqual({ a: '', b: '' });
    expect(activeFilterCount(values)).toBe(0);
    expect(activeFilterCount({ ...values, a: 'x', b: '  ' })).toBe(1);
  });
});
