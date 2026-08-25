-- C · Portal idempotency ledger — docs/api/11-portal.md §3
--
-- Every one of the 7 portal writes requires an Idempotency-Key, scoped
-- (vendor_id, endpoint, idempotency_key), unique-constrained. No existing
-- table provides this (unlike payments.idempotency_key, the one precedent) —
-- the portal surface has nothing to persist a replay against.

create table portal_idempotency_keys (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid        not null references vendors(id),
  endpoint         text        not null,
  idempotency_key  text        not null,
  response         jsonb       not null,
  created_at       timestamptz not null default now(),
  unique (vendor_id, endpoint, idempotency_key)
);

grant select, insert on portal_idempotency_keys to vendor_api;

-- attachments.uploaded_by is a hard FK to the internal `users` table, not
-- vendor_users/auth.users — a vendor-originated upload (POD, bill, KYC
-- document) still needs a valid users.id to attribute to.
insert into users (name, email, role_id)
  select 'Portal System', 'portal-system@nexraah.internal', id from roles where code = 'ADMIN'
  on conflict (email) do nothing;

-- Portal-issued quote codes. `number_series` (which already seeds a QUOTE /
-- BID- row for the internal side) is in vendor_api's blanket REVOKE ALL list
-- in 20260814090200_c1_roles_grants.sql — deliberately, alongside clients,
-- invoices and payments, not an oversight. A quote code is not a
-- legally-significant gapless document series the way an LR or invoice
-- number is (NFR-08's gap-free guarantee is about those), so rather than
-- widen that revoke, portal-submitted quotes get their own sequence vendor_api
-- can use directly — no visibility into the shared numbering ledger at all.
create sequence portal_quote_code_seq start 1;
grant usage on sequence portal_quote_code_seq to vendor_api;
