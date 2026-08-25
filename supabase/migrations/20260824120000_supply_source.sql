-- Supply source — where the vehicles on a branch or a lane actually come from.
--
-- A branch's supply is not one thing: some lanes are served by the local
-- transport union, some off the open market, some by owners we contract
-- directly, and most branches are a mix. Placement, rate-sheet negotiation and
-- market-gap recruitment all hinge on which it is, and until now that lived
-- only in people's heads.
--
-- Recorded in three places, because it is decided at three moments:
--   rfq_lanes        — when sourcing a lane, this is what we found
--   rate_card_lanes  — the rate sheet carries it forward as the agreed basis
--   branches         — the branch's overall posture, shown to its manager
--
-- `supply_remarks` is deliberately free text and never required: the four
-- values cannot express "union only during cane season", and forcing an
-- operator to pick a wrong enum loses more than an empty column does.
--
-- Safe against NFR-02: all three tables are blanket-revoked from `vendor_api`
-- (20260814090200_c1_roles_grants.sql:122-125), so no column added here is
-- reachable from the transporter surface.

alter table branches
  add column supply_source  text
    check (supply_source in ('UNION', 'MARKET', 'BOTH', 'DIRECT_OWNER')),
  add column supply_remarks text;

alter table rate_card_lanes
  add column supply_source  text
    check (supply_source in ('UNION', 'MARKET', 'BOTH', 'DIRECT_OWNER')),
  add column supply_remarks text;

alter table rfq_lanes
  add column supply_source  text
    check (supply_source in ('UNION', 'MARKET', 'BOTH', 'DIRECT_OWNER')),
  add column supply_remarks text;

comment on column branches.supply_source is
  'Where this branch sources vehicles: UNION | MARKET | BOTH | DIRECT_OWNER. Null until an operator sets it.';
comment on column rate_card_lanes.supply_source is
  'Agreed supply basis for this lane, carried from the RFQ lane it was awarded from.';
comment on column rfq_lanes.supply_source is
  'What sourcing found for this lane. Feeds the rate card on award.';

-- Branch managers filter their own supply board by source.
create index rate_card_lanes_supply_source_idx
  on rate_card_lanes (supply_source) where supply_source is not null;
