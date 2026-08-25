-- Client onboarding — Compliance clears a client before we carry for them.
--
-- Until now a client was created straight to ACTIVE and was immediately
-- usable: no papers, no credibility check, nobody's sign-off. The integration
-- audit recorded "company credibility check on client/vendor onboarding" as an
-- open gap, and this is the client half of it.
--
-- Modelled deliberately on the vendor pipeline rather than inventing a second
-- shape for the same idea. A vendor goes DRAFT -> PENDING_VERIFICATION ->
-- ACTIVE, carries `vendor_documents` with PENDING/VERIFIED/REJECTED, and
-- cannot be given loads until Compliance clears it. A client now does the
-- same, and cannot have indents raised against it until Compliance clears it.
-- Same states, same document states, same gate — one thing to learn, not two.
--
-- Ownership: Compliance runs onboarding (new `client.onboard` permission).
-- Finance keeps `client.manage` — the commercial record, credit terms and
-- billing — which is unchanged. Nothing any role can do today is removed.

-- ---------------------------------------------------------------- status ---
-- The old constraint allowed only ACTIVE/INACTIVE. Dropped and rebuilt rather
-- than added to, because a column cannot carry two competing check constraints
-- and have either mean anything.
alter table clients drop constraint if exists clients_status_check;

alter table clients
  add constraint clients_status_check check (status in (
    'DRAFT',                 -- being captured, not yet submitted
    'PENDING_VERIFICATION',  -- with Compliance
    'ACTIVE',                -- cleared; indents may be raised
    'REJECTED',              -- Compliance declined; reason recorded
    'INACTIVE'               -- was active, since stood down
  ));

-- New clients start unverified. This is the behaviour change the feature
-- exists to make: creating a client is no longer the same act as approving
-- one. Existing rows are untouched and stay ACTIVE — a migration that
-- retrospectively un-approved every live client would stop the business
-- rather than tighten it.
alter table clients alter column status set default 'DRAFT';

-- Why Compliance said no. Null for every other status; carried so a rejected
-- client can be answered when they ask, rather than the reason living only in
-- somebody's memory of the conversation.
alter table clients add column if not exists rejection_reason text;
alter table clients add column if not exists verified_by uuid references users(id);
alter table clients add column if not exists verified_at timestamptz;

-- A rejection with no reason is the thing this column exists to prevent.
alter table clients
  add constraint clients_rejection_needs_reason
    check (status <> 'REJECTED' or rejection_reason is not null);

-- ------------------------------------------------------------- documents ---
-- Mirrors `vendor_documents` column for column where the meaning is the same,
-- so anything that already knows how to render one can render the other.
create table client_documents (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid        not null references clients(id) on delete cascade,
  kind          text        not null check (kind in (
                  'GST_CERTIFICATE',   -- proves the GSTIN we will bill against
                  'PAN',
                  'SIGNED_AGREEMENT',  -- the rate contract; CONTRACT clients only
                  'CREDIT_CHECK'       -- the credibility check the audit asked for
                )),
  attachment_id uuid        references attachments(id),
  reference     text,
  valid_from    date,
  valid_to      date,
  status        text        not null default 'PENDING'
                            check (status in ('PENDING','VERIFIED','REJECTED')),
  reject_reason text,
  verified_by   uuid        references users(id),
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint client_documents_validity check (valid_to is null or valid_to >= valid_from),
  -- One document per kind per client, exactly as `vendor_documents` and
  -- `trip_documents` do it. Re-submitting replaces rather than accumulates,
  -- so "which GST certificate is the current one" is never a question.
  constraint client_documents_kind_unique unique (client_id, kind)
);

create index client_documents_client_idx on client_documents (client_id);
create index clients_status_idx          on clients (status);

-- ------------------------------------------------------------ permission ---
-- Not a fixed permission (BR-40/BR-43 reserve those for payment.release,
-- pod.waive, rfq.submit and config.manage), so it may be granted onward if the
-- business decides a second desk should onboard clients.
insert into permissions (code) values ('client.onboard')
on conflict (code) do nothing;

-- Compliance owns it. ADMIN gets it for the same reason it gets the rest of
-- the operational set — to be able to open the screen — while the approve.*
-- decisions stay elsewhere.
insert into role_permissions (role_id, permission_id, level)
select r.id, p.id, 'EDIT'
from roles r
cross join permissions p
where p.code = 'client.onboard'
  and r.code in ('COMPLIANCE', 'ADMIN')
on conflict do nothing;

-- ---------------------------------------------------------------- backfill --
-- Every client that already exists was implicitly trusted, so record that as
-- a fact rather than leaving it ambiguous: they are ACTIVE, and their
-- documents were never collected. New ones go through the pipeline.
--
-- Deliberately does NOT invent VERIFIED document rows for them. A verified
-- document nobody verified is worse than a missing one — it would show a
-- compliance officer a cleared checklist for papers that were never seen.
update clients
   set status = 'ACTIVE'
 where status is null;
