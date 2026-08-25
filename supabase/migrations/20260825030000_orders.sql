-- Orders — the ten-step spine, as a record.
--
-- FLOWS.md §6 calls the ten steps "the spine of the whole application", and
-- until now the spine was not stored anywhere. `/orders` was assembled in the
-- browser: `apps/internal-portal/src/app/orders/apis.ts` fetched every indent,
-- every trip and every invoice on each load and ran `statusFor()` over the
-- join. That had four consequences worth naming, because they are what this
-- migration exists to end:
--
--   1. The list and the detail disagreed. The list called `statusFor` with
--      `advanceDocsUploaded: null` (it had no per-document data) while the
--      detail passed the real value, so one order legitimately rendered as
--      "LR issued" in the list and "Advance documents uploaded" on its own
--      page.
--   2. No order number. An order was referred to by its indent's code, so
--      there was nothing to quote to a client that survived the indent.
--   3. No history. Nothing recorded when a step happened or who did it, so
--      "when did this go out?" had no answer.
--   4. No paging and no querying by step — the client-side join had to pull
--      three whole tables to answer "show me what is stuck at advance".
--
-- The design keeps the derivation honest rather than duplicating truth: the
-- underlying tables (`indents`, `trips`) stay authoritative for their own
-- facts, and `orders.status` is a *materialised* view of them, recomputed by
-- `OrdersService.recompute()` at each transition. One function, server-side,
-- used by both list and detail — which is precisely what the two disagreeing
-- copies of the ladder could never be.

-- The ten steps plus the exception branch, in the user's own wording
-- (FLOWS.md §11). FAILED is not step zero — it is the branch an indent takes
-- when nobody could be found by the deadline, and it can return to the ladder.
create table orders (
  id            uuid primary key default gen_random_uuid(),
  order_no      text        not null unique,                 -- ORD-
  -- One order per indent. The indent is the request; the order is its journey.
  indent_id     uuid        not null unique references indents(id) on delete cascade,
  -- Denormalised pointers, written by recompute(). They exist so the list can
  -- answer "which trip / which bill" without re-joining three tables per row.
  trip_id       uuid        references trips(id),
  invoice_id    uuid        references invoices(id),
  client_id     uuid        not null references clients(id),
  branch_id     uuid        not null references branches(id),
  status        text        not null default 'INDENT_CREATED' check (status in (
                  'FAILED',
                  -- Proof never arrived; the balance is forfeited. Terminal,
                  -- and deliberately not one of the ten — an order here will
                  -- never reach step 10, and must not read as though it might.
                  'POD_FORFEITED',
                  'INDENT_CREATED',
                  'TRIP_GENERATED',
                  'LR_ISSUED',
                  'ADVANCE_DOCS_UPLOADED',
                  'ADVANCE_PAID',
                  'TRACKING',
                  'UNLOADED',
                  'POD_UPLOADED',
                  'POD_VERIFIED',
                  'BALANCE_RELEASED')),
  -- 1..10 for the ladder. FAILED reports 1 (it never left placement) and
  -- POD_FORFEITED reports 9 (it reached the proof stage and stops there for
  -- good). Stored so a list can sort and filter by progress without teaching
  -- SQL the vocabulary.
  step_no       integer     not null default 1 check (step_no between 1 and 10),
  -- Set on either terminal exit — BALANCE_RELEASED or POD_FORFEITED.
  -- `closed_at is null` is the index-friendly definition of "still live".
  -- FAILED is deliberately NOT terminal: a failed placement can be re-quoted
  -- and rejoin the ladder, so closing it would drop it out of the open queue
  -- while somebody is still trying to place it.
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index orders_status_idx  on orders (status);
create index orders_branch_idx  on orders (branch_id);
create index orders_client_idx  on orders (client_id);
create index orders_open_idx    on orders (closed_at) where closed_at is null;
create index orders_created_idx on orders (created_at desc);

-- Step history. One row per *entry* into a step, so the timeline reads as
-- "what happened, when, and who did it" rather than as a diff of two states.
--
-- Deliberately append-only: nothing updates or deletes a row here. A step the
-- order re-enters (a failed placement that is re-quoted and succeeds) appends
-- again rather than overwriting, because "this took three attempts" is exactly
-- the kind of fact the old derived view destroyed.
create table order_events (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid        not null references orders(id) on delete cascade,
  status        text        not null,
  step_no       integer     not null check (step_no between 1 and 10),
  -- Null for the steps that happen on their own (tracking pings, the nightly
  -- placement-failure sweep). A null actor is "the system did this", which is
  -- a real answer and better than attributing it to whoever happened to load
  -- the screen that triggered the recompute.
  actor_user_id uuid        references users(id),
  note          text,
  at            timestamptz not null default now()
);

create index order_events_order_idx on order_events (order_id, at desc);

-- ORD- numbers are global, not branch-scoped: an order number is quoted to a
-- client, and a client does not care which of our branches ran it.
--
-- Key casing and conflict target both matter here. `20260814090400` re-seeded
-- this table with upper-case wire keys (`TRIP`, `INDENT`) to match
-- docs/api/01-foundation.md, replaced the `key` primary key with an `id`, and
-- made uniqueness `(key, branch_id) nulls not distinct` — so a lower-case
-- 'order' would never be found by `NumberingService.issue()`, and a conflict
-- target of `(key)` alone would not resolve to an index that exists.
insert into number_series (key, prefix, next_value, width, scope, branch_id) values
  ('ORDER', 'ORD-', 1, 5, 'GLOBAL', null)
on conflict (key, branch_id) do nothing;

-- Backfill. Every indent that already exists gets an order, numbered in
-- creation order so the sequence reads chronologically rather than by however
-- Postgres happened to return the rows.
--
-- The status is left at its default here and corrected on first read: the
-- ladder depends on trip stage, POD status and payment amounts, and encoding
-- that ladder twice — once in SQL, once in TypeScript — is how the list and
-- the detail drifted apart in the first place. `OrdersService.recompute()` is
-- the single copy, and `backfilled` marks the rows that still need it.
with numbered as (
  select
    i.id,
    i.client_id,
    i.branch_id,
    row_number() over (order by i.created_at, i.code) as n
  from indents i
)
insert into orders (order_no, indent_id, client_id, branch_id, status, step_no, created_at)
select
  'ORD-' || lpad((numbered.n)::text, 5, '0'),
  numbered.id,
  numbered.client_id,
  numbered.branch_id,
  'INDENT_CREATED',
  1,
  now()
from numbered
on conflict (indent_id) do nothing;

-- Advance the series past whatever the backfill consumed, so the first order
-- raised after this migration does not collide with a backfilled one.
update number_series
   set next_value = greatest(next_value, (select count(*) + 1 from orders)),
       updated_at = now()
 where key = 'ORDER' and branch_id is null;
