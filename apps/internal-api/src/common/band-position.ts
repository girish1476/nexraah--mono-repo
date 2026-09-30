export type BandPosition = 'BELOW_BAND' | 'IN_BAND' | 'ABOVE_BAND';

/**
 * Where a quote sits against the lane's bid limits.
 *
 * Shared by the transporter portal's quote submit and the desk's "enter a
 * quote", so a price is classified the same way whoever keys it. Below the
 * floor is not refused — it is kept and flagged for Operations to judge.
 * Above the ceiling is kept too, and awarding it goes to approval (D-39).
 * A lane with no limit on one side simply never lands on that side.
 */
export function bandPositionFor(amountPaise: number, bidMinPaise: number | null, bidMaxPaise: number | null): BandPosition {
  if (bidMaxPaise !== null && amountPaise > bidMaxPaise) return 'ABOVE_BAND';
  if (bidMinPaise !== null && amountPaise < bidMinPaise) return 'BELOW_BAND';
  return 'IN_BAND';
}
