-- Order flow, second round of the operations team's notes (30 Sep 2026).
--
-- 1. Rate basis. Some clients agree a price for the whole truck (FTL), others
--    per metric tonne (PMT). A lane records which, and a load raised on a PMT
--    lane is priced at rate x weight.
-- 2. Deleting a duplicate rate. Leadership or an administrator can remove a
--    lane entered twice. The row is kept (loads already raised point at it)
--    and marked deleted, with who did it and why; every read skips it.
-- 3. Addresses on the load request, so the order page can show where it is
--    loaded and where it is delivered even when no lorry receipt is made.
-- 4. E-POD or H-POD. A delivery proof is either an electronic copy uploaded
--    by the desk (E-POD) or the signed hard copy received by courier (H-POD).
-- 5. Tracking sheet. Manual position updates for a trip on the road, until it
--    reaches the unloading point and is unloaded.
--
-- New tables reach `internal_api` only, by the default privileges in
-- 20260814090200_c1_roles_grants.sql; `vendor_api` is granted nothing here.
--
-- Forward-only and idempotent.

-- 1 · rate basis --------------------------------------------------------------
alter table rate_card_lanes add column if not exists rate_basis text not null default 'FTL';
alter table rate_card_lanes drop constraint if exists rate_card_lanes_rate_basis_check;
alter table rate_card_lanes add constraint rate_card_lanes_rate_basis_check check (rate_basis in ('FTL', 'PMT'));

-- 2 · deleted duplicates ------------------------------------------------------
alter table rate_card_lanes add column if not exists deleted_at    timestamptz;
alter table rate_card_lanes add column if not exists deleted_by    uuid references users(id);
alter table rate_card_lanes add column if not exists delete_reason text;

-- 3 · addresses ---------------------------------------------------------------
alter table indents add column if not exists pickup_address text;
alter table indents add column if not exists drop_address   text;

-- 4 · E-POD / H-POD -----------------------------------------------------------
alter table pod_receipts add column if not exists pod_kind text not null default 'HPOD';
alter table pod_receipts drop constraint if exists pod_receipts_pod_kind_check;
alter table pod_receipts add constraint pod_receipts_pod_kind_check check (pod_kind in ('EPOD', 'HPOD'));

-- 5 · tracking sheet ----------------------------------------------------------
--    The sheet starts when the vehicle is allocated: on the way to the loading
--    point, reached it, loaded (only then are the advance documents uploaded),
--    on the road, reached the unloading point, unloaded (only then is the
--    proof of delivery uploaded).
alter table trips add column if not exists reached_loading_at     timestamptz;
alter table trips add column if not exists reached_destination_at timestamptz;

create table if not exists trip_tracking_updates (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid        not null references trips(id) on delete cascade,
  kind        text        not null default 'UPDATE'
              check (kind in ('UPDATE', 'REACHED_LOADING', 'LOADED', 'DEPARTED', 'REACHED', 'UNLOADED')),
  location    text        not null check (length(btrim(location)) between 2 and 200),
  lat         numeric(9, 6) check (lat between -90 and 90),
  lng         numeric(9, 6) check (lng between -180 and 180),
  note        text        check (note is null or length(note) <= 500),
  recorded_by uuid        references users(id),
  recorded_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint trip_tracking_coords_together check ((lat is null) = (lng is null))
);

create index if not exists trip_tracking_updates_trip_idx on trip_tracking_updates (trip_id, recorded_at);
