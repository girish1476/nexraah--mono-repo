-- The towns a branch serves besides its own city.
--
-- BR-20 takes a load's branch from its pickup city, and BR-34 a transporter's
-- from their base city. With no geocoding provider both match the branch's
-- `city` by exact name, so a pickup at Achuthapuram — 50 km from the
-- Visakhapatnam branch — matched nothing and the load could not be raised
-- (found in pre-prod, 4 Nov 2026). Nothing in the console could fix that.
--
-- An administrator now lists those towns on the branch (Administration →
-- Branches → "Also serves"). The API keeps one town to one branch, so a match
-- stays unambiguous.

alter table branches
  add column served_cities text[] not null default '{}';

comment on column branches.served_cities is
  'Towns this branch also serves, matched case-insensitively with city when deriving a branch (BR-20, BR-34).';
