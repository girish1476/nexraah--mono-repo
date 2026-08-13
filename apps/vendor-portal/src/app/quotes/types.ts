export type QuoteStatus =
  | 'SUBMITTED'
  | 'PENDING_APPROVAL'
  | 'WON'
  | 'LOST'
  | 'WITHDRAWN';

/**
 * A lost quote carries no winning price, no quote count, no competitor
 * (part 02 · `BR-55`). `lostReason` is a fixed enum, never free text about
 * another vendor.
 */
export interface Quote {
  id: string;
  loadCode: string;
  originCity: string;
  destinationCity: string;
  amountPaise: number;
  status: QuoteStatus;
  submittedAt: string;
  aboveBandByPaise: number | null;
  tripId: string | null;
  lostReason: 'AWARDED_ELSEWHERE' | 'INDENT_CANCELLED' | 'EXPIRED' | null;
}
