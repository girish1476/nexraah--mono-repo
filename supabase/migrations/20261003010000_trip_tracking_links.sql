-- A shareable live-tracking link for a trip.
--
-- Operations can send a client, or the truck's owner, a link that shows where
-- the truck is — by WhatsApp or SMS — without giving them a login. The link is
-- an unguessable token; whoever holds it sees one trip's route, milestones and
-- positions, and nothing else: no client name, no transporter name, no rates,
-- no internal notes. So the same link is safe to send to either side.
--
-- It lives as long as the journey: it stops answering once the truck is
-- unloaded (`trips.delivered_at`), or earlier if Operations switches it off
-- (`revoked_at`). One live link per trip — creating one again returns it.
--
-- `internal_api` gets its usual access through the schema's default
-- privileges; `vendor_api` gets none (tables default to unreachable for it).
--
-- Forward-only and idempotent.

create table if not exists trip_tracking_links (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid        not null references trips(id) on delete cascade,
  token       text        not null unique,
  created_by  uuid        references users(id),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- At most one link that has not been switched off, per trip.
create unique index if not exists trip_tracking_links_live_idx
  on trip_tracking_links (trip_id) where revoked_at is null;
