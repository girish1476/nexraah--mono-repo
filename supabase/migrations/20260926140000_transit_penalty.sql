-- Late-delivery ("transit") penalty: the trip's side.
--
-- The penalty is decided per lane (see 20260927000000): it varies with the
-- client, the route and the truck type. The trip records when its transit clock
-- started — the day loading was done, or failing that the day it departed — so
-- the days on the road can be worked out on delivery, and keeps the penalty
-- that came out of that. A trip with neither date is never charged one.
--
-- Forward-only and idempotent.

alter table trips
  add column if not exists departed_at     timestamptz,
  add column if not exists transit_penalty bigint not null default 0
    check (transit_penalty >= 0);
