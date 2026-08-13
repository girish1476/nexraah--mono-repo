-- C1 · schema — 39 tables, part 02 §1–§6 made runnable
--
-- Conventions (part 14 §3):
--   ids          uuid pk default gen_random_uuid()
--   money        bigint, paise, NOT NULL. No numeric/float/real/money anywhere near money
--   status       text + CHECK, never a native enum
--   timestamps   created_at / updated_at timestamptz on every table
--   dates        date for date-only, timestamptz otherwise. Never `timestamp`
--   fk           declared always, ON DELETE RESTRICT unless the child is meaningless alone
--
-- Where part 02 wrote enum values in pipe notation they become a CHECK. Where it
-- did not name the values, the column is bare `text` with a comment — inventing a
-- value set here would be a decision this migration has no authority to make.

-- ─────────────────────────────────────────────────────────────
-- 1 · Identity and configuration
-- ─────────────────────────────────────────────────────────────

create table branches (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,
  name          text        not null,
  city          text        not null,
  -- The one deliberate numeric in the schema. See the note at the foot of this file.
  lat           numeric(9,6),
  lng           numeric(9,6),
  catchment_km  integer     not null default 150,          -- BR-34
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table roles (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,
  name          text        not null,
  is_system     boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table permissions (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,               -- payment.release, pod.verify, …
  created_at    timestamptz not null default now()
);

create table role_permissions (
  role_id       uuid        not null references roles(id)       on delete cascade,
  permission_id uuid        not null references permissions(id) on delete cascade,
  level         text        not null check (level in ('NONE','VIEW','EDIT')),   -- BR-29
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  -- Part 14 §4.1. SET NULL rather than cascade: a deleted login must not delete
  -- the actor rows the audit trail points at.
  auth_user_id  uuid        unique references auth.users(id) on delete set null,
  name          text        not null,
  email         text        not null unique,
  phone         text,
  role_id       uuid        not null references roles(id),
  branch_id     uuid        references branches(id),
  status        text        not null default 'ACTIVE'
                            check (status in ('ACTIVE','DISABLED')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table config (
  key           text primary key,
  value         jsonb       not null,
  updated_by    uuid        references users(id),
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table number_series (
  key           text primary key,
  prefix        text        not null,
  next_value    bigint      not null default 1 check (next_value >= 1),
  width         integer     not null default 4  check (width between 1 and 12),
  scope         text        not null check (scope in ('GLOBAL','BRANCH')),
  branch_id     uuid        references branches(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- BR-14 / NFR-08: a BRANCH-scoped series without a branch would collide silently
  constraint number_series_scope_branch
    check ((scope = 'BRANCH') = (branch_id is not null))
);

create table attachments (
  id            uuid primary key default gen_random_uuid(),
  kind          text        not null,
  entity_type   text        not null,
  entity_id     uuid        not null,
  storage_path  text        not null unique,
  mime          text        not null,
  bytes         bigint      not null check (bytes > 0 and bytes <= 10 * 1024 * 1024),
  sha256        text        not null check (sha256 ~ '^[0-9a-f]{64}$'),  -- server-computed, 11-portal §4
  uploaded_by   uuid        not null references users(id),
  uploaded_at   timestamptz not null default now(),
  retain_until  date,                                       -- NFR-10, R-04
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table approvals (
  id            uuid primary key default gen_random_uuid(),
  kind          text        not null check (kind in (
                  'ABOVE_BAND_PRICE','ADVANCE_OVERRIDE','ADVANCE_POLICY_CHANGE',
                  'PENALTY_WAIVER','DOC_OVERRIDE','BRANCH_OVERRIDE')),
  entity_type   text        not null,
  entity_id     uuid        not null,
  requester_id  uuid        not null references users(id),
  reason        text        not null check (char_length(reason) >= 20),  -- REASON_TOO_SHORT
  payload       jsonb       not null,                       -- replayed verbatim on approval
  status        text        not null default 'PENDING'
                            check (status in ('PENDING','APPROVED','REJECTED')),
  approver_id   uuid        references users(id),
  decided_at    timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint approvals_decided_together
    check ((status = 'PENDING') = (approver_id is null and decided_at is null))
);

create table audit_events (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  actor_id      uuid        references users(id),
  actor_role    text        not null,                       -- ADR-02: 'PORTAL' for portal writes
  actor_vendor_id uuid,                                     -- set only when actor_role = 'PORTAL'
  action        text        not null,
  entity_type   text        not null,
  entity_id     uuid,
  before        jsonb,
  after         jsonb,
  request_id    text                                        -- X-Request-Id, ADR-02 §7
);

create trigger audit_events_no_update before update on audit_events
  for each row execute function public.audit_events_immutable();
create trigger audit_events_no_delete before delete on audit_events
  for each row execute function public.audit_events_immutable();

-- ─────────────────────────────────────────────────────────────
-- 2 · Supply
-- ─────────────────────────────────────────────────────────────

create table vendors (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- VND-
  legal_name    text        not null,
  party_type    text        not null check (party_type in ('OWNER','VENDOR')),
  base_city     text        not null,
  branch_id     uuid        not null references branches(id),
  gstin         text,
  pan           text,
  phone         text        not null unique,
  alt_phone     text,
  fleet_base    integer     not null default 0 check (fleet_base >= 0),
  operating_states text[]   not null default '{}',
  advance_pct   integer     not null default 0 check (advance_pct between 0 and 100),
  bank_account  text,
  ifsc          text,
  account_holder text,
  status        text        not null default 'DRAFT' check (status in (
                  'DRAFT','PENDING_VERIFICATION','ACTIVE','SUSPENDED','BLACKLISTED')),
  verified_by   uuid        references users(id),
  panel_date    date,
  rating        integer     check (rating between 1 and 5),
  source        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Spec 1 §2.2 / part 14 §4.1. The UNIQUE is the point: PortalGuard fails closed
-- on a second row, and without this constraint the schema permits the state it
-- fails closed on.
create table vendor_users (
  user_id       uuid primary key references users(id)   on delete cascade,
  vendor_id     uuid        not null references vendors(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table vendor_kyc (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid        not null references vendors(id) on delete cascade,
  kind          text        not null check (kind in ('PAN','AADHAAR','ADDRESS','SELFIE')),
  value_masked  text,
  route         text        not null check (route in ('API','MANUAL')),   -- BR-31
  status        text        not null default 'PENDING'
                            check (status in ('PENDING','VERIFIED','REJECTED')),
  verified_by   uuid        references users(id),
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- BR-04: Aadhaar is held as last four only, enforced here and not in a service
  constraint vendor_kyc_aadhaar_last_four
    check (kind <> 'AADHAAR' or value_masked is null or char_length(value_masked) <= 4),
  unique (vendor_id, kind)
);

create table vendor_documents (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid        not null references vendors(id) on delete cascade,
  kind          text        not null check (kind in (
                  'TRADE_LICENCE','LABOUR_LICENCE','RC','UDYAM',
                  'TDS_DECLARATION','BANK_STATEMENT')),
  attachment_id uuid        references attachments(id),
  valid_from    date,
  valid_to      date,
  status        text        not null default 'PENDING'
                            check (status in ('PENDING','VERIFIED','REJECTED')),
  verified_by   uuid        references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vendor_documents_validity check (valid_to is null or valid_to >= valid_from)
);

create table vendor_fleet (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid        not null references vendors(id) on delete cascade,
  registration  text        not null unique,
  type          text        not null,
  capacity_kg   integer     not null check (capacity_kg > 0),   -- renamed, see foot of file
  body_type     text,
  current_city  text,
  free_from     date,
  status        text        not null default 'AVAILABLE' check (status in (
                  'AVAILABLE','ON_TRIP','DOCS_DUE','MAINTENANCE')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table vendor_advance_history (                       -- BR-57
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid        not null references vendors(id) on delete cascade,
  old_pct       integer     not null check (old_pct between 0 and 100),
  new_pct       integer     not null check (new_pct between 0 and 100),
  approval_id   uuid        references approvals(id),
  changed_by    uuid        not null references users(id),
  changed_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table leads (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- LD-, NOT the indent series
  name          text        not null,
  city          text,
  source        text,
  party_type    text        check (party_type in ('OWNER','VENDOR')),
  trucks_claimed integer    check (trucks_claimed >= 0),
  phone         text,
  owner_id      uuid        references users(id),
  stage         text        not null,                       -- values not named in part 02
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table market_gap_targets (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid        not null references branches(id),
  lane          text        not null,
  truck_type    text        not null,
  target        integer     not null check (target >= 0),
  on_panel      integer     not null default 0 check (on_panel  >= 0),
  converted     integer     not null default 0 check (converted >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (branch_id, lane, truck_type)
);

-- ─────────────────────────────────────────────────────────────
-- 3 · Demand and rates
-- ─────────────────────────────────────────────────────────────

create table clients (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- CLT-
  name          text        not null,
  billing_city  text        not null,
  gstin         text,
  contact       text,
  phone         text,
  email         text,
  engagement    text        not null check (engagement in ('SPOT','CONTRACT')),
  agreement_no  text,
  valid_from    date,
  valid_to      date,
  agreement_attachment_id uuid references attachments(id),
  credit_days   integer     not null default 0 check (credit_days >= 0),
  service_level text,
  status        text        not null default 'ACTIVE'
                            check (status in ('ACTIVE','INACTIVE')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table rfqs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid        not null references clients(id),
  cycle_months  integer     not null check (cycle_months in (3,6,12)),
  period_from   date        not null,
  period_to     date        not null,
  due_at        timestamptz,
  reference     text,
  status        text        not null default 'DRAFT' check (status in (
                  'DRAFT','SOURCING','QUOTED','SUBMITTED','AWARDED','LOST','CLOSED')),
  submitted_by  uuid        references users(id),
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint rfqs_period check (period_to > period_from)
);

create table rfq_lanes (
  id            uuid primary key default gen_random_uuid(),
  rfq_id        uuid        not null references rfqs(id) on delete cascade,
  origin        text        not null,
  destination   text        not null,
  truck_type    text        not null,
  transit_days  integer     check (transit_days >= 0),
  reporting_rule text       check (reporting_rule in ('SAME_DAY','NEXT_DAY','SCHEDULED')),
  sourcing_mode text        check (sourcing_mode in ('MONTHLY','HIGH_LOW')),
  -- BR-36: every component stored. quoted_rate is derived and never keyed by hand.
  sourcing_avg  bigint      check (sourcing_avg >= 0),
  overhead      bigint      check (overhead     >= 0),
  margin        bigint,
  quoted_rate   bigint      check (quoted_rate  >= 0),
  outcome       text        check (outcome in ('WON','LOST','WITHDRAWN')),
  awarded_rate  bigint      check (awarded_rate >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table rfq_lane_sourcing (
  id            uuid primary key default gen_random_uuid(),
  rfq_lane_id   uuid        not null references rfq_lanes(id) on delete cascade,
  month         date,                                       -- null on a HIGH_LOW pair
  rate          bigint      not null check (rate >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table rate_card_lanes (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid        not null references clients(id),
  -- BR-37 enforced by the schema, not a service. Part 12 imports against a
  -- synthetic closed RFQ precisely because this cannot be null.
  rfq_lane_id   uuid        not null references rfq_lanes(id),
  origin        text        not null,
  destination   text        not null,
  truck_type    text        not null,
  rate          bigint      not null check (rate > 0),
  transit_days  integer     check (transit_days >= 0),
  reporting_rule text       check (reporting_rule in ('SAME_DAY','NEXT_DAY','SCHEDULED')),
  valid_from    date        not null,
  valid_to      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint rate_card_lanes_validity check (valid_to is null or valid_to >= valid_from)
);

-- ─────────────────────────────────────────────────────────────
-- 4 · Orders
-- ─────────────────────────────────────────────────────────────

create table indents (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- IND-
  client_id     uuid        not null references clients(id),
  branch_id     uuid        not null references branches(id),   -- BR-20, carried unchanged
  from_city     text        not null,
  to_city       text        not null,
  material      text        not null,
  weight_kg     integer     not null check (weight_kg > 0),
  truck_type    text        not null,
  pickup_date   date        not null,
  transit_days  integer     check (transit_days >= 0),
  reporting_rule text       check (reporting_rule in ('SAME_DAY','NEXT_DAY','SCHEDULED')),
  remarks       text,
  sell_rate     bigint      not null check (sell_rate > 0),
  buy_rate      bigint      check (buy_rate > 0),            -- BR-06, written at award
  rate_source   text        not null check (rate_source in ('CONTRACT','SPOT')),
  rate_card_lane_id uuid    references rate_card_lanes(id),
  sourcing_rate bigint      check (sourcing_rate >= 0),
  spot_confirmation_attachment_id uuid references attachments(id),
  bid_min       bigint      check (bid_min > 0),
  bid_max       bigint      check (bid_max > 0),
  band_locked   boolean     not null default false,          -- BR-39
  advance_pct   integer     not null default 0 check (advance_pct between 0 and 100),
  stage         text        not null default 'OPEN' check (stage in (
                  'OPEN','VENDOR_ASSIGNED','VEHICLE_PLACED','TRIP_CREATED')),
  vendor_id     uuid        references vendors(id),
  awarded_quote_id uuid,                                     -- FK added after `quotes`
  vehicle_no    text,
  driver_name   text,
  driver_licence text,
  reported_at   timestamptz,
  failure_cause text,                                        -- BR-18
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- BR-26: a spot indent cannot exist without the client's written rate confirmation
  constraint indents_spot_needs_confirmation
    check (rate_source <> 'SPOT' or spot_confirmation_attachment_id is not null),
  -- BR-38: spot freight is never quoted at or below the sourcing rate
  constraint indents_spot_above_sourcing
    check (rate_source <> 'SPOT' or (sourcing_rate is not null and sell_rate > sourcing_rate)),
  constraint indents_band_ordered
    check (bid_min is null or bid_max is null or bid_max >= bid_min)
);

create table quotes (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- BID-
  indent_id     uuid        not null references indents(id) on delete cascade,
  vendor_id     uuid        not null references vendors(id),
  -- BR-05 / D-39: below bid_min is refused at entry and never persisted, so the
  -- schema needs no floor. Above band is persisted, flagged, and approved.
  amount        bigint      not null check (amount > 0),
  truck_registration text,
  remarks       text,
  band_position text        not null check (band_position in ('IN_BAND','ABOVE_BAND')),
  status        text        not null default 'SUBMITTED' check (status in (
                  'SUBMITTED','ACCEPTED','REJECTED','WITHDRAWN')),
  submitted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One live quote per vendor per load. QUOTE_EXISTS (11-portal §2) is this
  -- constraint surfacing, and withdraw is what clears it.
  unique (indent_id, vendor_id)
);

alter table indents
  add constraint indents_awarded_quote_fk
  foreign key (awarded_quote_id) references quotes(id);

create table trips (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- TRP-
  indent_id     uuid        not null references indents(id),
  client_id     uuid        not null references clients(id),   -- never granted to vendor_api
  vendor_id     uuid        not null references vendors(id),
  branch_id     uuid        not null references branches(id),
  vehicle_no    text        not null,
  vehicle_type  text,
  capacity_kg   integer     check (capacity_kg > 0),
  driver_name   text,
  driver_licence text,
  lane          text,
  weight_kg     integer     check (weight_kg > 0),
  transit_days_required integer check (transit_days_required >= 0),   -- BR-27
  actual_transit_days   integer check (actual_transit_days   >= 0),
  remarks       text,
  buy_rate      bigint      not null check (buy_rate > 0),   -- their freight, granted
  eway_no       text,
  eway_valid_till timestamptz,
  stage         text        not null default 'OPEN' check (stage in (
                  'OPEN','IN_TRANSIT','DELIVERED','CLOSED')),
  delivered_at  timestamptz,
  -- BR-48 five states plus Forfeited, plus ATTACHED which the portal owns
  -- (05-pod.md §14) and the console picks up at RECEIVED.
  pod_status    text        not null default 'PENDING' check (pod_status in (
                  'PENDING','ATTACHED','RECEIVED','VERIFIED','APPROVED','REJECTED','FORFEITED')),
  pod_received_at timestamptz,                               -- BR-49, the clock stops here
  pod_penalty   bigint      not null default 0 check (pod_penalty >= 0),   -- BR-24
  pod_closure_basis text    check (pod_closure_basis in ('APPROVED','WAIVED','FORFEITED')),
  advance_paid  bigint      not null default 0 check (advance_paid >= 0),
  balance_paid  bigint      not null default 0 check (balance_paid >= 0),
  billed        boolean     not null default false,          -- never granted to vendor_api
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table trip_documents (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid        not null references trips(id) on delete cascade,
  kind          text        not null,                       -- eleven kinds, seeded in config
  attachment_id uuid        references attachments(id),
  status        text        not null default 'PENDING'
                            check (status in ('PENDING','VERIFIED','REJECTED')),
  verified_by   uuid        references users(id),
  verified_at   timestamptz,
  reject_reason text,
  keyed_values  jsonb,                                      -- feeds the BR-32 cross-check
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (trip_id, kind)
);

create table trip_charges (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid        not null references trips(id) on delete cascade,
  charge_type   text        not null,
  -- BR-45: what it cost us and what we bill the client are different numbers and
  -- are never derived from one another
  cost_amount   bigint      not null default 0 check (cost_amount   >= 0),
  billed_amount bigint      not null default 0 check (billed_amount >= 0),
  captured_by   uuid        not null references users(id),
  captured_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table lorry_receipts (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- LR-
  trip_id       uuid        not null unique references trips(id),   -- BR-22, one per trip
  lr_date       date        not null,
  booked_at     timestamptz not null default now(),
  branch_id     uuid        not null references branches(id),
  -- Snapshots, not references: the printed LR is the contract of carriage and must
  -- not change when a vendor later edits their fleet row or a client is renamed.
  consignor     jsonb       not null,                       -- never granted to vendor_api
  consignee     jsonb       not null,                       -- never granted to vendor_api
  goods         jsonb       not null,
  invoice       jsonb,                                      -- never granted to vendor_api
  eway          jsonb,
  vehicle       jsonb       not null,
  driver        jsonb       not null,
  transit_days  integer     check (transit_days >= 0),
  remarks       text,
  charges       jsonb,
  status        text        not null default 'BOOKED' check (status in (
                  'BOOKED','RELEASED','IN_TRANSIT','DELIVERED')),
  shared_at     timestamptz,                                -- BR-22, sharing is optional
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- A jsonb column with no shape is a text column with extra steps. These are the
  -- keys the printed document is not legal without.
  constraint lr_consignor_named check (jsonb_exists(consignor, 'name')),
  constraint lr_consignee_named check (jsonb_exists(consignee, 'name'))
);

create table pod_receipts (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- PDR-
  trip_id       uuid        not null references trips(id) on delete cascade,
  courier_docket text,
  sent_on       date,
  received_on   date,                                       -- BR-49, stops the clock
  pages         integer     check (pages > 0),
  received_by   uuid        references users(id),
  condition     text,
  attachment_ids uuid[]     not null default '{}',           -- no FK possible on an array
  verified_by   uuid        references users(id),
  verified_at   timestamptz,
  checklist     jsonb,
  approved_by   uuid        references users(id),
  approved_at   timestamptz,
  reject_reason text,
  supersedes_id uuid        references pod_receipts(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- BR-50: the approver is never the verifier
  constraint pod_approver_not_verifier
    check (approved_by is null or approved_by <> verified_by),
  -- BR-51: attachment requires the docket and the sent-on date together
  constraint pod_attach_needs_docket
    check ((courier_docket is null) = (sent_on is null))
);

create table vendor_bills (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid        not null references trips(id),
  vendor_id     uuid        not null references vendors(id),
  bill_no       text        not null,
  bill_date     date        not null,
  attachment_id uuid        references attachments(id),
  freight       bigint      not null check (freight >= 0),
  charges       bigint      not null default 0 check (charges >= 0),
  total         bigint      not null check (total >= 0),
  submitted_at  timestamptz not null default now(),
  computed_balance bigint   not null,
  -- BR-53: a bill above the computed balance is flagged for the desk, never
  -- rejected. The transporter is often right.
  variance      bigint      not null generated always as (total - computed_balance) stored,
  status        text        not null default 'SUBMITTED'
                            check (status in ('SUBMITTED','ACCEPTED','QUERIED')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (vendor_id, bill_no)
);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid        references trips(id),
  indent_id     uuid        references indents(id),
  kind          text        not null check (kind in ('ADVANCE','BALANCE')),
  gross         bigint      not null check (gross >= 0),
  penalty       bigint      not null default 0 check (penalty >= 0),
  -- BR-11: net is derived, never keyed. A service cannot get this wrong.
  net           bigint      not null generated always as (gross - penalty) stored,
  -- BR-09: every one of these is required at release
  mode            text      not null,
  transfer_type   text      not null,
  remitting_account text    not null,
  utr             text      not null,
  value_date      date      not null,
  released_by   uuid        not null references users(id),
  released_at   timestamptz not null default now(),
  idempotency_key text      not null unique,                -- 00-conventions §8
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint payments_advance_on_indent_balance_on_trip
    check ((kind = 'ADVANCE' and indent_id is not null)
        or (kind = 'BALANCE' and trip_id   is not null))
);

-- ─────────────────────────────────────────────────────────────
-- 5 · Money in, telemetry, notifications
-- ─────────────────────────────────────────────────────────────

create table invoices (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- NEX-INV-
  client_id     uuid        not null references clients(id),
  invoice_date  date        not null,
  due_date      date        not null,
  freight       bigint      not null default 0 check (freight    >= 0),
  loading       bigint      not null default 0 check (loading    >= 0),
  unloading     bigint      not null default 0 check (unloading  >= 0),
  detention     bigint      not null default 0 check (detention  >= 0),
  other         bigint      not null default 0 check (other      >= 0),
  discount      bigint      not null default 0 check (discount   >= 0),
  round_off     bigint      not null default 0,              -- the one rupee rounding, NFR-09
  total         bigint      not null check (total >= 0),
  received      bigint      not null default 0 check (received >= 0),
  -- BR-15: reverse charge only. The tax columns are retained and always zero.
  tax_mechanism text        not null default 'REVERSE_CHARGE'
                            check (tax_mechanism = 'REVERSE_CHARGE'),
  taxable       bigint      not null default 0,
  cgst          bigint      not null default 0 check (cgst = 0),
  sgst          bigint      not null default 0 check (sgst = 0),
  igst          bigint      not null default 0 check (igst = 0),
  status        text        not null default 'DRAFT' check (status in (
                  'DRAFT','ISSUED','PART_PAID','PAID','CANCELLED')),
  cancel_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint invoices_due_after_date check (due_date >= invoice_date),
  constraint invoices_cancel_reason
    check (status <> 'CANCELLED' or char_length(coalesce(cancel_reason,'')) >= 20)
);

create table invoice_trips (
  invoice_id    uuid        not null references invoices(id) on delete cascade,
  trip_id       uuid        not null references trips(id),
  created_at    timestamptz not null default now(),
  primary key (invoice_id, trip_id),
  -- A trip is billed once. BR-35's P&L depends on it.
  unique (trip_id)
);

create table receipts (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- RCT-
  invoice_id    uuid        not null references invoices(id),
  client_id     uuid        not null references clients(id),
  amount        bigint      not null check (amount > 0),     -- BR-16
  received_on   date        not null,
  mode          text        not null,
  reference     text,
  remarks       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The only table that grows continuously. Everything else grows at ~2,400 trips
-- a year; this one needs a retention policy before it needs a second index.
create table telematics_pings (
  id            bigserial primary key,
  vehicle_no    text        not null,
  at            timestamptz not null,
  lat           numeric(9,6),
  lng           numeric(9,6),
  speed         integer,                                    -- km/h
  fuel          integer,                                    -- percent
  raw           jsonb,
  created_at    timestamptz not null default now()
);

create table telematics_alerts (
  id            uuid primary key default gen_random_uuid(),
  vehicle_no    text        not null,
  trip_id       uuid        references trips(id),
  kind          text        not null,                       -- BR-19
  raised_at     timestamptz not null default now(),
  cleared_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  event         text        not null,
  channel       text        not null check (channel in ('SMS','PUSH','EMAIL')),
  recipient     text        not null,
  template_id   text        not null,                       -- DLT-registered, D-31
  payload       jsonb       not null,
  status        text        not null default 'PENDING',
  sent_at       timestamptz,
  provider_ref  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Declared after `trips` because it points at one.
create table issues (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,                -- IS-
  vendor_id     uuid        not null references vendors(id) on delete cascade,
  category      text        not null,
  severity      text        not null,
  raised_by     uuid        not null references users(id),
  raised_at     timestamptz not null default now(),
  trip_id       uuid        references trips(id),
  status        text        not null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 6 · Indexes — part 02 §8 plus part 14 §5.1
-- ─────────────────────────────────────────────────────────────

create index indents_stage_pickup_idx      on indents (stage, pickup_date);
create index trips_pod_delivered_idx       on trips   (pod_status, delivered_at);
create index trips_branch_delivered_idx    on trips   (branch_id, delivered_at);

create index quotes_indent_idx             on quotes  (indent_id);
create index quotes_vendor_status_idx      on quotes  (vendor_id, status);
create index trips_vendor_stage_idx        on trips   (vendor_id, stage);
create index indents_vendor_idx            on indents (vendor_id);
create index vendor_users_vendor_idx       on vendor_users (vendor_id);
create index attachments_entity_idx        on attachments  (entity_type, entity_id);
create index audit_events_entity_idx       on audit_events (entity_type, entity_id, at desc);
create index telematics_pings_vehicle_idx  on telematics_pings (vehicle_no, at desc);
create index pod_receipts_trip_idx         on pod_receipts (trip_id);
create index vendor_bills_trip_idx         on vendor_bills (trip_id);
create index invoices_client_status_idx    on invoices (client_id, status);

-- ─────────────────────────────────────────────────────────────
-- 7 · updated_at, everywhere it exists
-- ─────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'updated_at'
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t, t);
  end loop;
end
$$;

-- ─────────────────────────────────────────────────────────────
-- Two departures from part 02, both deliberate
-- ─────────────────────────────────────────────────────────────
--
-- 1 · weight_tn / capacity_tn are `weight_kg` / `capacity_kg`, integer.
--     NFR-09 bans numeric and float from the schema. Whole tonnes would lose the
--     half-tonne loads this business actually runs, so the unit changes rather
--     than the type. The API still exposes `weightTn`; the grant lists in
--     vendor-specs/01-P1 §1.2 need the same rename — applied in the roles
--     migration, and the spec text should follow.
--
-- 2 · branches.lat/lng and telematics_pings.lat/lng are numeric(9,6).
--     A coordinate is not money and integer microdegrees buys nothing but
--     arithmetic bugs. NFR-09's enforcement clause reads "no numeric or float in
--     the schema"; its intent is money precision. The test in
--     supabase/tests/grants.sql asserts no numeric on any MONEY column and lists
--     these four as the known exceptions, so the rule stays testable.
