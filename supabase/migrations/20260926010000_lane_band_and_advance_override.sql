-- Bid band moves to the client's rate card; advance % becomes a per-order override.
--
-- 1. The bid band (`bid_min` / `bid_max`) used to be typed onto every indent by
--    whoever raised it. It is a commercial term of the client's rate, not a
--    per-order judgement, so it now lives on the agreed lane in
--    `rate_card_lanes` and an indent takes it from the lane in force. Changing
--    a band that already exists goes to Leadership (`LANE_BAND_CHANGE`).
--
-- 2. `advance_pct` on an indent was overwritten with the awarded vendor's
--    standing policy at award, so anything entered when the indent was raised
--    was silently discarded. `advance_pct_overridden` records "this order asked
--    for its own figure", and award keeps it instead of overwriting it.
--
-- Forward-only and idempotent.

alter table rate_card_lanes
  add column if not exists bid_min bigint check (bid_min > 0),
  add column if not exists bid_max bigint check (bid_max > 0);

alter table rate_card_lanes
  drop constraint if exists rate_card_lanes_band_order;
alter table rate_card_lanes
  add constraint rate_card_lanes_band_order
  check (bid_min is null or bid_max is null or bid_max >= bid_min);

comment on column rate_card_lanes.bid_min is
  'Floor a transporter quote may go to on this lane (paise). Below it a quote is refused at entry. Copied onto the indent when it is raised.';
comment on column rate_card_lanes.bid_max is
  'Ceiling for a normal award on this lane (paise). Above it a quote is kept and flagged, and awarding it needs Leadership.';

alter table indents
  add column if not exists advance_pct_overridden boolean not null default false;

comment on column indents.advance_pct_overridden is
  'True when the person raising the indent asked for this order''s own advance %, so award keeps it instead of taking the vendor''s standing policy.';

-- A band change on an existing lane is a Leadership decision.
alter table approvals drop constraint if exists approvals_kind_check;
alter table approvals
  add constraint approvals_kind_check check (kind in (
    'ABOVE_BAND_PRICE','ADVANCE_OVERRIDE','ADVANCE_POLICY_CHANGE',
    'PENALTY_WAIVER','DOC_OVERRIDE','BRANCH_OVERRIDE','RATE_REVISION',
    'LANE_BAND_CHANGE'));
