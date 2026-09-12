-- The audit trail becomes readable.
--
-- `audit_events` has been written on every mutation since day one (NFR-03) and
-- read by nothing. The audit module has a service and no controller, no route,
-- no query — so "transactions check" and "legitimacy of operations", both
-- named as Finance's job in the owner's own team notes, could not be done in
-- the app at all. The data was always there; there was no door.
--
-- Nothing about how the trail is written changes here. It stays append-only:
-- `internal_api` holds no UPDATE or DELETE grant on the table and a trigger
-- raises regardless (`20260814090000`/`…090200`). This adds a read, and only
-- a read.

-- ---------------------------------------------------------------- permission
insert into permissions (code) values ('audit.view')
on conflict (code) do nothing;

-- FINANCE, LEADERSHIP and ADMIN.
--
--   * FINANCE because the owner's notes put "Transactions Check, Recording of
--     transactions" and "legitimacy of operations" on that desk. This is the
--     surface for that work.
--   * LEADERSHIP because oversight of every desk is what the role is, and an
--     oversight role that cannot read the log is oversight on paper.
--   * ADMIN because the approvals inbox already describes itself as "an audit
--     view, never a decision" for admin, and this is the same posture applied
--     to the rest of the system.
--
-- COMPLIANCE is deliberately NOT granted it, and that is a judgement call
-- rather than an oversight. Their remit is verifying documents and clearing
-- parties, and every queue they need is already theirs. The trail carries
-- money movement and personal identity data across every desk, so it is
-- granted where somebody's named job requires it and nowhere else. If the
-- business wants Compliance to run the half-yearly checkup the notes mention,
-- adding them here is one line.
--
-- Note what this permission does NOT do: it cannot alter, hide, or delete an
-- entry, because nothing can. It is read-only by construction, not by policy.
insert into role_permissions (role_id, permission_id, level)
select r.id, p.id, 'VIEW'
from roles r
cross join permissions p
where p.code = 'audit.view'
  and r.code in ('FINANCE', 'LEADERSHIP', 'ADMIN')
on conflict do nothing;

-- ------------------------------------------------------------------- index
-- The three ways the trail actually gets read: "what happened lately"
-- (default), "what happened to this record" (an invoice, a trip, a payment),
-- and "what did this person do" (the one a dispute starts from). Without
-- these, every one of them is a sequential scan of a table that only ever
-- grows.
create index if not exists audit_events_at_idx
  on audit_events (at desc);

create index if not exists audit_events_entity_idx
  on audit_events (entity_type, entity_id, at desc);

create index if not exists audit_events_actor_idx
  on audit_events (actor_id, at desc);

comment on column audit_events.before is
  'The record as it stood before the change. Null for a creation.';
comment on column audit_events.after is
  'The record as it stood after the change. Null for a deletion.';
