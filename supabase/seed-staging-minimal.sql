-- Minimal staging seed — ONE record per entity, so a first login has exactly
-- one real example to click through end to end rather than a wall of
-- fixtures. This is deliberately NOT `seed.sql`: that file is explicitly
-- documented as local-dev-only ("NEVER applied to staging or production",
-- part 14 §10) and carries a vendor in three states plus trips pinned to
-- specific money-gate ages — useful for exercising every screen in
-- automated tests, wrong for a real person's first look at a real database.
--
-- Run ONCE, after migrations and after `provision.mjs` (which creates the
-- real staff Auth accounts from `staff.example.json` — this file does not
-- touch `auth.*` at all, on purpose: staff logins are provisioning's job,
-- not this file's).
--
--   npx supabase db push --db-url <session-pooler URL as postgres>
--   node supabase/scripts/provision.mjs
--   psql <session-pooler URL> -f supabase/seed-staging-minimal.sql
--
-- Everything below is a placeholder. The branch (code `HQ`) is meant to be
-- renamed or replaced with your real branch(es) once you have them. Every
-- other row — the client, transporter, fleet truck and load request — is
-- named with a `SAMPLE` code (`CLT-SAMPLE`, `VND-SAMPLE`, `IND-SAMPLE`, fleet
-- registration `SAMPLE0001`) specifically so they're easy to find and delete
-- once real data starts arriving. Order matters — each step frees the
-- reference the next one needs to delete cleanly:
--   delete from indents where code = 'IND-SAMPLE';
--   delete from rate_card_lanes where client_id = (select id from clients where code = 'CLT-SAMPLE');
--   delete from rfqs where client_id = (select id from clients where code = 'CLT-SAMPLE'); -- cascades to rfq_lanes
--   delete from vendor_fleet where registration = 'SAMPLE0001';
--   delete from vendors where code = 'VND-SAMPLE';
--   delete from clients where code = 'CLT-SAMPLE';
--
-- The indent is left at step 1 (OPEN) rather than pre-advanced through the
-- ladder, so the first real session can walk the whole ten-step flow by
-- hand: quote it as the sample transporter, award it, issue the LR, upload
-- advance docs, verify, pay the advance, mark departed/delivered, upload
-- POD, verify it, release the balance. Watching the flow happen is the
-- point, not reading a trip that already finished it.
--
-- Rate type is CONTRACT, not SPOT: a SPOT indent's own CHECK constraint
-- (`indents_spot_needs_confirmation`, BR-26) requires a real attachment row,
-- which in turn requires a real `users.id` — a dependency on whichever staff
-- account `provision.mjs` happens to create, which this file has no
-- business assuming. CONTRACT only needs the RFQ → lane → rate-card chain
-- below, which is self-contained (BR-37 is the same reason `seed.sql` builds
-- one for its own indents).

begin;

insert into branches (code, name, city, lat, lng) values
  ('HQ', 'Sample branch — rename or add your real branches', 'Update this city', 0, 0)
on conflict (code) do nothing;

insert into clients (code, name, billing_city, engagement, credit_days, status) values
  ('CLT-SAMPLE', 'Sample Client Pvt Ltd', 'Update this city', 'CONTRACT', 15, 'ACTIVE')
on conflict (code) do nothing;

insert into vendors (code, legal_name, party_type, base_city, branch_id, phone,
                     advance_pct, status, panel_date, fleet_base)
select 'VND-SAMPLE', 'Sample Transport Co', 'VENDOR', 'Update this city', b.id,
       '9800000000', 70, 'ACTIVE', current_date - 30, 1
  from branches b where b.code = 'HQ'
on conflict (code) do nothing;

insert into vendor_fleet (vendor_id, registration, type, capacity_kg, status, current_city)
select v.id, 'SAMPLE0001', '32FT_SXL', 18000, 'AVAILABLE', 'Update this city'
  from vendors v where v.code = 'VND-SAMPLE'
on conflict (vendor_id, registration) do nothing;

-- One RFQ lane, because BR-37 means a rate card cannot exist without one —
-- see `seed.sql`'s identical comment on its own copy of this chain.
insert into rfqs (client_id, cycle_months, period_from, period_to, status)
select c.id, 12, date_trunc('year', current_date)::date,
       (date_trunc('year', current_date) + interval '1 year - 1 day')::date, 'AWARDED'
  from clients c where c.code = 'CLT-SAMPLE'
  and not exists (select 1 from rfqs r join clients c2 on c2.id = r.client_id where c2.code = 'CLT-SAMPLE');

insert into rfq_lanes (rfq_id, origin, destination, truck_type, transit_days,
                       sourcing_mode, sourcing_avg, overhead, margin, quoted_rate,
                       outcome, awarded_rate)
select r.id, 'Update this city', 'Update this city', '32FT_SXL', 2,
       'MONTHLY', 4000000, 300000, 200000, 4500000, 'WON', 4500000
  from rfqs r join clients c on c.id = r.client_id
 where c.code = 'CLT-SAMPLE'
   and not exists (select 1 from rfq_lanes l where l.rfq_id = r.id);

insert into rate_card_lanes (client_id, rfq_lane_id, origin, destination, truck_type,
                             rate, transit_days, valid_from)
select r.client_id, l.id, l.origin, l.destination, l.truck_type,
       l.awarded_rate, l.transit_days, current_date - 1
  from rfq_lanes l join rfqs r on r.id = l.rfq_id join clients c on c.id = r.client_id
 where c.code = 'CLT-SAMPLE'
   and not exists (select 1 from rate_card_lanes rc where rc.rfq_lane_id = l.id);

insert into indents (code, client_id, branch_id, from_city, to_city, material,
                     weight_kg, truck_type, pickup_date, transit_days, sell_rate,
                     rate_source, rate_card_lane_id, bid_min, bid_max, advance_pct, stage)
select 'IND-SAMPLE', c.id, b.id, rc.origin, rc.destination,
       'Sample goods — edit or replace', 10000, '32FT_SXL', current_date + 3, 2,
       4500000, 'CONTRACT', rc.id, 4000000, 4500000, 70, 'OPEN'
  from clients c, branches b, rate_card_lanes rc
 where c.code = 'CLT-SAMPLE' and b.code = 'HQ' and rc.client_id = c.id
on conflict (code) do nothing;

-- Advance past every code used above, the same way `seed.sql` does — the
-- first vendor/client/indent created through the running app must not
-- collide with these on a `duplicate key value` error.
update number_series set next_value = greatest(next_value, 2) where key = 'VENDOR';
update number_series set next_value = greatest(next_value, 2) where key = 'CLIENT';
-- INDENT's code here is non-numeric (`IND-SAMPLE`, not `IND-####`) precisely
-- so it can never collide with a real series-issued code — no series bump
-- needed for it.

commit;
