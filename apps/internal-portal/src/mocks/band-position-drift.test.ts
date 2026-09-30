import { describe, expect, it } from 'vitest';
import { bandPositionFor as fixture } from './band-position';
// The real implementation, imported straight out of internal-api.
import { bandPositionFor as api } from '../../../internal-api/src/common/band-position';

describe('band position: fixture agrees with the API', () => {
  const limits: (number | null)[] = [null, 30_000_00, 35_000_00];

  it('gives identical results across the edges of every band', () => {
    for (const min of limits) {
      for (const max of limits) {
        for (const amount of [1, 29_999_99, 30_000_00, 32_000_00, 35_000_00, 35_000_01, 90_000_00]) {
          expect(fixture(amount, min, max)).toEqual(api(amount, min, max));
        }
      }
    }
  });

  it('keeps a quote under the floor as BELOW_BAND instead of refusing it', () => {
    expect(fixture(25_000_00, 30_000_00, 35_000_00)).toBe('BELOW_BAND');
    expect(fixture(36_000_00, 30_000_00, 35_000_00)).toBe('ABOVE_BAND');
    expect(fixture(32_000_00, 30_000_00, 35_000_00)).toBe('IN_BAND');
  });
});
