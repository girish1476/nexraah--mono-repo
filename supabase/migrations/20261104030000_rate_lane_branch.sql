-- The branch that runs a rate card lane's loads.
--
-- An indent's branch was worked out from its pickup city alone, by exact city
-- name (BR-20, `indents.service.ts`). A lane from a town that is not itself a
-- branch city — a plant outside Nashik, a port near Gandhidham — could be
-- agreed and priced, and then no indent could be raised on it: "Cannot derive a
-- branch from pickup city". The lane now says which branch runs it, chosen when
-- the lane is added, and an indent on the lane takes that branch.
--
-- Lanes already on rate cards get the branch serving their from city (its own
-- city, or a town under "Also serves" — 20261104020000) where exactly one
-- does. The rest stay empty — the indent still falls back to the pickup city —
-- until somebody sets it on the client's rate card.
--
-- Forward-only and idempotent.

alter table rate_card_lanes
  add column if not exists branch_id uuid references branches(id);

create index if not exists rate_card_lanes_branch_idx on rate_card_lanes (branch_id);

update rate_card_lanes l
set branch_id = (
  select b.id from branches b
  where lower(trim(b.city)) = lower(trim(l.origin))
     or exists (select 1 from unnest(b.served_cities) as town(name) where lower(trim(town.name)) = lower(trim(l.origin)))
)
where l.branch_id is null
  and (
    select count(*) from branches b
    where lower(trim(b.city)) = lower(trim(l.origin))
       or exists (select 1 from unnest(b.served_cities) as town(name) where lower(trim(town.name)) = lower(trim(l.origin)))
  ) = 1;
