-- C2 · correction — the onboarding wizard's fleet step had nowhere to write
--
-- `PATCH /vendors/:id` step 3 has always sent `fleetCount`/`truckTypes`, but
-- `vendors` had no matching columns — `ValidationPipe({ whitelist: true })`
-- (main.ts) strips undeclared fields silently, so the request returned 200
-- and the values vanished. `getById()`'s `fleetCount` is (and stays) the
-- count of actual `vendor_fleet` rows — a separate, not-yet-built truck
-- registration path — so what's declared here is kept apart from it rather
-- than conflated with it.
--
-- Also links a converted lead back to the vendor it became, so "Start
-- onboarding" on a qualified lead can record the conversion instead of
-- silently forgetting where the vendor file came from.

alter table vendors
  add column declared_fleet_count integer not null default 0 check (declared_fleet_count >= 0),
  add column truck_types text[] not null default '{}',
  add column fleet_body_type text;

alter table leads
  add column converted_vendor_id uuid references vendors(id);
