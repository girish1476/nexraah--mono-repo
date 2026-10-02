-- The exact loading and unloading points of a client's route.
--
-- An indent names two cities. A driver needs a gate: which plant, which
-- godown, where on the map. Operations found that out by phone on every load
-- and it was kept nowhere, so it was asked again the next time the same client
-- moved the same route.
--
-- These rows keep it. They belong to the client and the route (from city → to
-- city), not to one trip: captured once on any trip, they are there for every
-- later vehicle placed for that client on that route, and correcting them on
-- one trip corrects them for the next.
--
-- Coordinates are optional (an address alone is still worth keeping) and come
-- as a pair or not at all. `numeric(9,6)`, like the other coordinates in the
-- schema (part 14 §3).
--
-- Forward-only and idempotent.

create table if not exists client_route_points (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid        not null references clients(id) on delete cascade,
  from_city         text        not null,
  to_city           text        not null,
  loading_address   text,
  loading_lat       numeric(9,6),
  loading_lng       numeric(9,6),
  unloading_address text,
  unloading_lat     numeric(9,6),
  unloading_lng     numeric(9,6),
  updated_by        uuid        references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint client_route_points_loading_pair   check ((loading_lat is null) = (loading_lng is null)),
  constraint client_route_points_unloading_pair check ((unloading_lat is null) = (unloading_lng is null))
);

-- One row per client and route, whatever the capitalisation of the cities.
create unique index if not exists client_route_points_route_idx
  on client_route_points (client_id, lower(from_city), lower(to_city));
