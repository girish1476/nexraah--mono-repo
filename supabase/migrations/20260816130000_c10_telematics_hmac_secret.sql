-- Part 11 §2 / docs/api/10-telematics-import.md: `POST /telematics/ping` is
-- HMAC-signed over the raw body with "a shared secret in config" — no JWT.
--
-- Deliberately dot-prefixed (`telematics.hmac_secret`), matching the
-- existing convention noted in ConfigRepository.findAll() ("the filter is
-- what excludes internal lookups like trip.document_kinds"): any key
-- containing a `.` is excluded from `GET /config`'s general listing. A
-- webhook signing secret must never be readable through the same endpoint
-- every authenticated internal user can call.
--
-- For the same reason this is NOT a field on PatchConfigDto (`PATCH
-- /config`) — that endpoint is for operationally visible settings an admin
-- tunes and can read back, not for secrets. Rotating this value is a new
-- migration (or, later, a dedicated admin-only "regenerate" endpoint) —
-- never the general config-patch surface.
--
-- Generated server-side with pgcrypto rather than a hardcoded placeholder,
-- so there is no plausible-looking-but-fake secret sitting in version
-- control. Whoever configures a real telematics provider retrieves the live
-- value with `select value from config where key = 'telematics.hmac_secret'`
-- and gives it to that provider out of band.
insert into config (key, value, updated_by)
values (
  'telematics.hmac_secret',
  to_jsonb(encode(gen_random_bytes(32), 'hex')),
  null
)
on conflict (key) do nothing;
