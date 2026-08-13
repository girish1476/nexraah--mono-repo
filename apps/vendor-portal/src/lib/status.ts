import type { Tone } from '@/components/shell';
import type { QuoteStatus } from '@/app/quotes/types';
import type { PodStatus, TripStatus } from '@/app/trips/types';
import type { VehicleStatus } from '@/app/fleet/types';
import type { DocumentStatus } from '@/app/profile/types';

/**
 * One meaning per colour, across every screen. Add a status here, not a
 * colour in a page.
 *
 * | Tone | Means | Reads as |
 * |------|-------|----------|
 * | mint | settled in your favour — verified, awarded, paid, approved | nothing to do |
 * | blue | moving, with us — submitted, on trip, in transit, with compliance | wait |
 * | flag | waiting on you, or on an approval | do something |
 * | red  | refused, rejected, or money blocked | fix it now |
 * | grey | inactive — withdrawn, closed, off-fleet | ignore |
 */
export const QUOTE_TONE: Record<QuoteStatus, Tone> = {
  SUBMITTED: 'blue',
  PENDING_APPROVAL: 'flag',
  WON: 'mint',
  LOST: 'red',
  WITHDRAWN: 'grey',
};

export const TRIP_TONE: Record<TripStatus, Tone> = {
  PLACED: 'blue',
  REPORTED: 'blue',
  LOADED: 'blue',
  IN_TRANSIT: 'blue',
  DELIVERED: 'mint',
  CLOSED: 'grey',
};

export const POD_TONE: Record<PodStatus, Tone> = {
  PENDING: 'flag',
  ATTACHED: 'blue',
  RECEIVED: 'blue',
  VERIFIED: 'blue',
  APPROVED: 'mint',
  REJECTED: 'red',
};

export const VEHICLE_TONE: Record<VehicleStatus, Tone> = {
  AVAILABLE: 'mint',
  ON_TRIP: 'blue',
  DOCS_DUE: 'flag',
  MAINTENANCE: 'grey',
};

export const DOCUMENT_TONE: Record<DocumentStatus, Tone> = {
  MISSING: 'flag',
  PENDING: 'blue',
  VERIFIED: 'mint',
  REJECTED: 'red',
  EXPIRED: 'flag',
};

/** A load is either open to you or already quoted — never a "good/bad" colour. */
export const LOAD_TONE = (quoted: boolean): Tone => (quoted ? 'blue' : 'grey');

/** Band verdict on the quote form, same three tones as everywhere else. */
export const BAND_TONE = (below: boolean, above: boolean): Tone =>
  below ? 'red' : above ? 'flag' : 'mint';
