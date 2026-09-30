/**
 * The fixture's copy of internal-api's `bandPositionFor`
 * (`common/band-position.ts`). A sibling drift test runs both through the
 * same scenarios and fails the day they disagree.
 */

export type BandPosition = 'BELOW_BAND' | 'IN_BAND' | 'ABOVE_BAND';

export function bandPositionFor(amountPaise: number, bidMinPaise: number | null, bidMaxPaise: number | null): BandPosition {
  if (bidMaxPaise !== null && amountPaise > bidMaxPaise) return 'ABOVE_BAND';
  if (bidMinPaise !== null && amountPaise < bidMinPaise) return 'BELOW_BAND';
  return 'IN_BAND';
}
