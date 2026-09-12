-- Telematics ping replay guard — BR-19 / part 11 §2.
--
-- TelematicsHmacGuard verifies the signature (timing-safe) and a 5-minute
-- clock-skew window on `at`, but neither stops a captured, validly-signed
-- ping from being replayed inside that window: the signature is computed
-- over the raw request body, which carries the ping's own `at`, so an exact
-- replay signs and verifies identically to the original and would otherwise
-- insert a second `telematics_pings` row for the same instant.
--
-- `unique (vehicle_no, at)` closes that — one row per vehicle per reported
-- timestamp — and `telematics.service.ts`'s `ingestPing` now catches the
-- resulting 23505 unique-violation and treats a replay as an idempotent
-- no-op instead of letting it bubble up as an unhandled 500.

alter table telematics_pings
  add constraint telematics_pings_vehicle_at_key unique (vehicle_no, at);
