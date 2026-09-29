-- A lane added to a client's rate card outside an RFQ is a commitment to bill
-- at a number, so it is proposed by `rate.revise` and countersigned through the
-- approvals engine on `approve.contract`, exactly as a revision is.
--
-- `approvals.kind` is mirrored by a CHECK constraint, and a kind the API knows
-- and the database does not fails on insert at runtime, not at build. Rebuilt
-- with every kind listed so far — the constraint cannot carry two competing
-- definitions.
--
-- No change to `rate_card_lanes.rfq_lane_id`: BR-37's provenance still holds.
-- A directly added lane points at a synthetic CLOSED rfq per client
-- (`reference = 'DIRECT/<client code>'`), the same approach the go-live import
-- takes, so "where did this rate come from" always has an answer.
--
-- Forward-only and idempotent.

alter table approvals drop constraint if exists approvals_kind_check;
alter table approvals
  add constraint approvals_kind_check check (kind in (
    'ABOVE_BAND_PRICE','ADVANCE_OVERRIDE','ADVANCE_POLICY_CHANGE',
    'PENALTY_WAIVER','DOC_OVERRIDE','BRANCH_OVERRIDE','RATE_REVISION',
    'LANE_BAND_CHANGE','RATE_CARD_LANE'));
