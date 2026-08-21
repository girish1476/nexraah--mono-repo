import { Pool, types } from 'pg';

// int8 (bigint — every money column, NFR-09) parses to JS number by default
// pg returns it as string. Safe to 2^53-1 paise (~₹90bn); NFR-05 volumes are
// nowhere near that. numeric (lat/lng, the four deliberate exceptions) is left
// as the driver's default string — coordinates are read, never arithmetic'd.
types.setTypeParser(20, (value) => (value === null ? null : parseInt(value, 10)));

// date (OID 1082 — pickup_date, lr_date, received_on, value_date, bill_date, …)
// left at pg's default parses to a JS `Date` via LOCAL-timezone date
// components, then `TransformInterceptor`'s JSON.stringify calls
// `.toISOString()`, which converts back to UTC — on a server east of UTC
// (IST) that shifts the calendar day backwards (e.g. a `2026-08-16` row
// round-trips as `2026-08-15T18:30:00.000Z`). `00-conventions.md` §5 also
// requires date-only fields on the wire as bare `YYYY-MM-DD`, not a
// timestamp, so leaving the type parser untouched was wrong twice over.
// Postgres already sends `date` as an unambiguous `YYYY-MM-DD` string over
// the wire; returning it as-is sidesteps the `Date` round-trip entirely.
types.setTypeParser(1082, (value) => value);

// Part 14 §5: session mode (or a direct connection), never transaction-mode
// pooling — the dual-pool control depends on the connection's Postgres role
// being the one bound here, which transaction-mode multiplexing does not
// preserve.
export const internalPool = new Pool({
  connectionString: process.env.DATABASE_URL_INTERNAL,
  max: 10,
});

export const portalPool = new Pool({
  connectionString: process.env.DATABASE_URL_PORTAL,
  max: 5,
});
