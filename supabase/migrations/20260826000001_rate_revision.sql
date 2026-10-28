-- Client rate revision — the write path the rate card never had.
--
-- `rate_card_lanes` has had exactly one write in the whole backend since day
-- one: an INSERT from the RFQ award (`rfq.repository.ts`). No UPDATE, no
-- DELETE. So an agreed price could be created and then never changed, and a
-- mid-contract revision meant running a fresh RFQ cycle for a number both
-- sides had already settled on the phone.
--
-- **A revision is not an edit.** It closes the current lane by setting
-- `valid_to`, and inserts a successor with the new rate and a `valid_from` the
-- day after. Three reasons, all of which an in-place UPDATE would break:
--
--   1. An indent raised last month was priced against last month's rate.
--      Mutating the row would make `rate-cross-check.ts` disagree with a
--      correctly-priced historical indent, because it compares against the
--      lane in force on the *pickup date*.
--   2. A billing dispute is argued from what was agreed at the time. An
--      overwritten rate cannot answer "what did we agree in March".
--   3. The schema already models periods (`valid_from`, `valid_to`,
--      `rate_card_lanes_validity`). Versioning by period is the shape the
--      table was built for; only the write path was missing.
--
-- So the rate card becomes append-only in practice, and the cross-check reads
-- whichever version covers the pickup date with no extra logic.

-- ---------------------------------------------------------------- permission
-- Who may PROPOSE a revision. Deliberately its own permission rather than
-- reusing `client.manage`: that is held by more than one desk and covers the
-- commercial record generally, while this moves an agreed price and should be
-- movable between desks on its own.
insert into permissions (code) values ('rate.revise')
on conflict (code) do nothing;

-- Seeded to FINANCE, and this is a DEFAULT rather than a settled decision.
--
-- The separation-of-duties argument, recorded here because it is the reason
-- and not an aside: BD holds `client.manage` and its own comment claims rate
-- cards, but BD deliberately does NOT hold `rfq.submit` — "the desk that
-- proposes a price never also sends it to the client". If BD both set the
-- lane price at sourcing and revised it mid-contract, the same desk would move
-- a price twice with no second signature. FINANCE does not build the RFQ, so
-- proposing from there keeps a second pair of eyes on the number.
--
-- The approval below makes that safe either way, so moving this grant to BD is
-- a one-line change if the business prefers it.
insert into role_permissions (role_id, permission_id, level)
select r.id, p.id, 'EDIT'
from roles r
cross join permissions p
where p.code = 'rate.revise'
  and r.code in ('FINANCE', 'ADMIN')
on conflict do nothing;

-- ------------------------------------------------------------------- history
-- Why a rate moved, kept beside what it moved to.
--
-- The successor lane records the new number; nothing would record the reason,
-- who asked, or who signed it off. For a figure that decides what a client is
-- billed, "we charged this because somebody changed it at some point" is not
-- an answer anybody can defend in a dispute.
create table rate_revisions (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid        not null references clients(id),
  -- The lane that was closed, and the one that replaced it. `to_lane_id` is
  -- null while the revision is still awaiting approval — the successor is not
  -- created until somebody signs it off.
  from_lane_id      uuid        not null references rate_card_lanes(id),
  to_lane_id        uuid        references rate_card_lanes(id),
  old_rate          bigint      not null check (old_rate > 0),
  new_rate          bigint      not null check (new_rate > 0),
  effective_from    date        not null,
  reason            text        not null,
  -- The approval that authorised it, so the signature is reachable from the
  -- rate rather than only from the approvals inbox.
  approval_id       uuid        references approvals(id),
  requested_by      uuid        not null references users(id),
  approved_by       uuid        references users(id),
  status            text        not null default 'PENDING'
                                check (status in ('PENDING','APPLIED','REJECTED')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A revision that does not change the number is a no-op somebody should be
  -- stopped from filing, not a record worth keeping.
  constraint rate_revisions_actually_revises check (new_rate <> old_rate)
);

create index rate_revisions_client_idx on rate_revisions (client_id);
create index rate_revisions_lane_idx   on rate_revisions (from_lane_id);
create index rate_revisions_open_idx   on rate_revisions (status) where status = 'PENDING';

-- ------------------------------------------------------- approval kind ---
-- A revision is proposed, not applied. The approval engine is the second
-- signature, so `approvals.kind` has to accept the new kind — its check
-- constraint has listed exactly six values since day one, and an insert of a
-- seventh fails at runtime, not at build. (This is the same trap as the
-- numbering-key seed: a constant added in TypeScript that the database has
-- never been told about.)
--
-- Rebuilt rather than added to, for the same reason the clients status check
-- was: a column cannot carry two competing check constraints and have either
-- mean anything.
alter table approvals drop constraint if exists approvals_kind_check;

alter table approvals
  add constraint approvals_kind_check check (kind in (
    'ABOVE_BAND_PRICE','ADVANCE_OVERRIDE','ADVANCE_POLICY_CHANGE',
    'PENALTY_WAIVER','DOC_OVERRIDE','BRANCH_OVERRIDE','RATE_REVISION'));

comment on table rate_revisions is
  'Why an agreed client rate moved, and who signed it off. The successor lane in rate_card_lanes carries the new number; this carries the reason and the approval.';
