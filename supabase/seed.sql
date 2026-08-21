-- Local fixtures — part 14 §10. NEVER applied to staging or production.
--
-- `supabase db reset` runs the migrations then this file. Enough data to open
-- every screen: a vendor in each of the three states that change what the UI
-- does, and trips at the stages the money gates care about.
--
-- Auth users are not created here — `supabase start` has no session to create
-- them from. Create one in Studio, then link it:
--   insert into vendor_users (user_id, vendor_id)
--   select u.id, v.id from users u, vendors v
--    where u.email = 'raj@sharma-transport.test' and v.code = 'VND-0001';

begin;

insert into branches (code, name, city, lat, lng) values
  ('BLR', 'Bengaluru', 'Bengaluru', 12.971599, 77.594566),
  ('HYD', 'Hyderabad', 'Hyderabad', 17.385044, 78.486671)
on conflict (code) do nothing;

insert into users (name, email, role_id, branch_id)
select v.name, v.email, r.id, b.id
  from (values
    ('Anita Desai',  'anita@nexraah.test',  'OPS',        'BLR'),
    ('Vikram Nair',  'vikram@nexraah.test', 'COMPLIANCE', 'BLR'),
    ('Priya Menon',  'priya@nexraah.test',  'FINANCE',    'BLR'),
    ('Sunita Rao',   'sunita@nexraah.test', 'BRANCH_MGR', 'HYD'),
    ('Arjun Kapoor', 'arjun@nexraah.test',  'LEADERSHIP', 'BLR'),
    ('Dev Admin',    'dev@nexraah.test',    'ADMIN',      'BLR')
  ) as v(name, email, role_code, branch_code)
  join roles    r on r.code = v.role_code
  join branches b on b.code = v.branch_code
on conflict (email) do nothing;

insert into vendors (code, legal_name, party_type, base_city, branch_id, phone,
                     advance_pct, status, panel_date, fleet_base)
select v.code, v.legal_name, v.party_type, v.base_city, b.id, v.phone,
       v.advance_pct, v.status, v.panel_date, v.fleet_base
  from (values
    ('VND-0001','Sharma Transport','VENDOR','Bengaluru','BLR','9880000001',70,'ACTIVE',              current_date - 400, 12),
    ('VND-0002','Karnataka Roadways','OWNER','Hubballi','BLR','9880000002',50,'PENDING_VERIFICATION',null,                4),
    ('VND-0003','Deccan Carriers','VENDOR','Hyderabad','HYD','9880000003',60,'SUSPENDED',            current_date - 900,  7)
  ) as v(code, legal_name, party_type, base_city, branch_code, phone,
         advance_pct, status, panel_date, fleet_base)
  join branches b on b.code = v.branch_code
on conflict (code) do nothing;

insert into vendor_fleet (vendor_id, registration, type, capacity_kg, status, current_city)
select v.id, f.registration, f.type, f.capacity_kg, f.status, f.city
  from (values
    ('VND-0001','KA01AB1234','32FT_SXL', 18000,'AVAILABLE','Bengaluru'),
    ('VND-0001','KA01AB5678','20FT',      9000,'ON_TRIP',  'Chennai'),
    ('VND-0001','KA05CD9012','32FT_MXL', 21000,'DOCS_DUE', 'Bengaluru'),
    ('VND-0003','TS09EF3456','32FT_SXL', 18000,'AVAILABLE','Hyderabad')
  ) as f(vendor_code, registration, type, capacity_kg, status, city)
  join vendors v on v.code = f.vendor_code
on conflict (registration) do nothing;

insert into clients (code, name, billing_city, engagement, credit_days, status) values
  ('CLT-0001','Meridian Foods','Bengaluru','CONTRACT',30,'ACTIVE'),
  ('CLT-0002','Sun Chemicals', 'Hyderabad','SPOT',    15,'ACTIVE')
on conflict (code) do nothing;

-- One RFQ lane, because BR-37 means a rate card cannot exist without one.
insert into rfqs (client_id, cycle_months, period_from, period_to, status)
select c.id, 12, date_trunc('year', current_date)::date,
       (date_trunc('year', current_date) + interval '1 year - 1 day')::date, 'AWARDED'
  from clients c where c.code = 'CLT-0001'
  and not exists (select 1 from rfqs);

insert into rfq_lanes (rfq_id, origin, destination, truck_type, transit_days,
                       sourcing_mode, sourcing_avg, overhead, margin, quoted_rate,
                       outcome, awarded_rate)
select r.id, 'Bengaluru', 'Chennai', '32FT_SXL', 2,
       'MONTHLY', 2800000, 200000, 400000, 3400000, 'WON', 3400000
  from rfqs r
  where not exists (select 1 from rfq_lanes);

insert into rate_card_lanes (client_id, rfq_lane_id, origin, destination, truck_type,
                             rate, transit_days, valid_from)
select r.client_id, l.id, l.origin, l.destination, l.truck_type,
       l.awarded_rate, l.transit_days, current_date - 30
  from rfq_lanes l join rfqs r on r.id = l.rfq_id
  where not exists (select 1 from rate_card_lanes);

-- Two contract indents: one open for quoting, one already awarded and running.
insert into indents (code, client_id, branch_id, from_city, to_city, material,
                     weight_kg, truck_type, pickup_date, transit_days, sell_rate,
                     rate_source, rate_card_lane_id, bid_min, bid_max, advance_pct, stage)
select i.code, c.id, b.id, 'Bengaluru', 'Chennai', i.material,
       i.weight_kg, '32FT_SXL', current_date + i.offs, 2, 3400000,
       'CONTRACT', rc.id, 2800000, 3200000, 70, i.stage
  from (values
    ('IND-4471','Packaged food', 18000, 1, 'OPEN'),
    ('IND-4472','Packaged food', 17500, -3,'TRIP_CREATED')
  ) as i(code, material, weight_kg, offs, stage)
  cross join lateral (select id from clients  where code = 'CLT-0001') c
  cross join lateral (select id from branches where code = 'BLR')      b
  cross join lateral (select id from rate_card_lanes limit 1)          rc
on conflict (code) do nothing;

-- A live quote on the open load, so the award screen has something to show.
insert into quotes (code, indent_id, vendor_id, amount, band_position, status)
select 'BID-00001', i.id, v.id, 3050000, 'IN_BAND', 'SUBMITTED'
  from indents i, vendors v
 where i.code = 'IND-4471' and v.code = 'VND-0001'
on conflict (code) do nothing;

-- One trip delivered and awaiting POD — the state both money gates key off.
insert into trips (code, indent_id, client_id, vendor_id, branch_id, vehicle_no,
                   vehicle_type, capacity_kg, driver_name, lane, weight_kg,
                   transit_days_required, buy_rate, stage, delivered_at,
                   pod_status, advance_paid)
select 'TRP-00001', i.id, i.client_id, v.id, i.branch_id, 'KA01AB5678',
       '20FT', 9000, 'Ramesh Kumar', 'Bengaluru-Chennai', 17500,
       2, 3000000, 'DELIVERED', now() - interval '22 days',
       'PENDING', 2100000
  from indents i, vendors v
 where i.code = 'IND-4472' and v.code = 'VND-0001'
on conflict (code) do nothing;

-- The fixture rows above hardcode their own codes rather than going through
-- `NumberingService.issue()`, so the series a live `POST` would draw from
-- next is left exactly where the migration seeded it — `VENDOR`/`CLIENT` at 1,
-- `QUOTE` at 1 (width 5, so its very first issue is literally `BID-00001`,
-- colliding with the fixture quote below). The first vendor, client or quote
-- created through the running API would fail on `duplicate key value
-- violates unique constraint` against a fixture row. Advancing past every
-- code actually used above keeps the fixtures and the live app out of each
-- other's way. `INDENT` already starts past 4471/4472 (4468 < both, but not
-- by much) — bumped too so a short burst of real indents doesn't catch up to
-- them either. `TRIP` is untouched: `TRP-00001` doesn't collide with the
-- `TRP-100241`-format codes that series actually issues.
update number_series set next_value = greatest(next_value, 4)    where key = 'VENDOR';
update number_series set next_value = greatest(next_value, 3)    where key = 'CLIENT';
update number_series set next_value = greatest(next_value, 4473) where key = 'INDENT';
update number_series set next_value = greatest(next_value, 2)    where key = 'QUOTE';

commit;

-- Delivered 22 days ago with pod_status PENDING puts TRP-00001 two days past the
-- BR-24 threshold, so the penalty accrual and the blocked balance gate both have
-- something real to render on first load.
