/** `BR-19` — the five alert kinds, part 11 §1 / docs/api/10-telematics-import.md. */
export type AlertKind = 'OVERSPEED' | 'LONG_HALT' | 'DARK_VEHICLE' | 'EWAY_EXPIRING' | 'EWAY_EXPIRED';

export const ALERT_KINDS: AlertKind[] = ['OVERSPEED', 'LONG_HALT', 'DARK_VEHICLE', 'EWAY_EXPIRING', 'EWAY_EXPIRED'];

/**
 * Trip stages that count as "open" for `POST /telematics/ping` acceptance
 * and for appearing on the live board — everything short of the two
 * terminal stages (`20260814090100_c1_schema.sql`'s `trips.stage` check).
 * Not spec'd precisely by name; this is the literal reading of "open trip".
 */
export const OPEN_TRIP_STAGES = ['OPEN', 'IN_TRANSIT'] as const;

/** Dot-prefixed so `ConfigRepository.findAll()`'s `key not like '%.%'` filter
 * excludes it from `GET /config` — this must never reach the frontend. */
export const HMAC_SECRET_CONFIG_KEY = 'telematics.hmac_secret';

/** `POST /telematics/ping` rejects a timestamp further than this from now — part 11 §2. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
