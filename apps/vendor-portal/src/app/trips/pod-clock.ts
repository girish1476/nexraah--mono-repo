import type { Tone } from '@/components/shell';
import { inr } from '@/lib/format';

/**
 * The POD window, stated the same way on every screen that shows it.
 * `BR-12` (20-day window) · `BR-24` (₹100/day from day 21) · `BR-25` (nothing
 * paid past 40 days). Attaching does not stop it — the branch receiving the
 * paper copy does (`BR-49`, `D-35`).
 */
export const POD_WINDOW_DAYS = 20;
export const POD_FORFEIT_DAYS = 40;

export interface PodClock {
  tone: Tone;
  headline: string;
  penaltyPaise: number;
  forfeited: boolean;
}

export function podClock(daysElapsed: number, perDayPaise: number): PodClock {
  if (daysElapsed > POD_FORFEIT_DAYS) {
    return {
      tone: 'red',
      headline: 'Forfeited — no balance is payable on this trip',
      penaltyPaise: 0,
      forfeited: true,
    };
  }
  if (daysElapsed > POD_WINDOW_DAYS) {
    const over = daysElapsed - POD_WINDOW_DAYS;
    return {
      tone: 'red',
      headline: `${inr(over * perDayPaise)} deducted so far — ${over} ${over === 1 ? 'day' : 'days'} over`,
      penaltyPaise: over * perDayPaise,
      forfeited: false,
    };
  }
  const left = POD_WINDOW_DAYS - daysElapsed;
  return {
    tone: 'mint',
    headline: `${left} ${left === 1 ? 'day' : 'days'} left in the window`,
    penaltyPaise: 0,
    forfeited: false,
  };
}

export const CLOCK_RULE =
  'After 20 days a deduction of ₹100 a day applies, and past 40 days no balance is paid.';

export const CLOCK_STOPS_AT =
  'The clock stops when we receive the paper copy, not when you attach it.';
