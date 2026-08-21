-- C2 · vendors & compliance — schema gaps docs/api/02-vendors-compliance.md and
-- internal-spec/03-C2-vendors-compliance.md need that 090100 didn't provide.
-- Forward-only (part 14 §2); vendor_kyc and vendor_documents already carry a
-- table-level GRANT to vendor_api (090200 §2), so no grant migration is needed
-- alongside this one.

-- BR-23: PAN and Aadhaar need a card photograph on file, not just a typed
-- value. The upload-then-reference pattern (00-conventions §10) needs
-- somewhere to put that reference — vendor_kyc had none.
alter table vendor_kyc add column attachment_id uuid references attachments(id);

-- docs/api/02-vendors-compliance.md §1 names TRANSPORTER_AGREEMENT as a
-- vendor_documents.kind; 090100's CHECK only had the six part 02 named.
alter table vendor_documents drop constraint vendor_documents_kind_check;
alter table vendor_documents add constraint vendor_documents_kind_check check (kind in (
  'TRADE_LICENCE','LABOUR_LICENCE','RC','UDYAM','TDS_DECLARATION','BANK_STATEMENT',
  'TRANSPORTER_AGREEMENT'
));

-- `POST /vendors/:id/documents/:kind` body carries an optional `reference`
-- (docs/api/02-vendors-compliance.md §1); part 02's table never named the column.
alter table vendor_documents add column reference text;

-- leads.stage and issues.severity/status were left bare text in 090100
-- ("values not named in part 02") because part 02 didn't name them. §3 vendor
-- spec now does.
alter table leads add constraint leads_stage_check check (stage in (
  'NEW','CONTACTED','DOCUMENTS_REQUESTED','QUALIFIED','CONVERTED','DROPPED'
));
alter table issues add constraint issues_severity_check check (severity in ('LOW','MEDIUM','HIGH'));
alter table issues add constraint issues_status_check check (status in ('OPEN','IN_PROGRESS','RESOLVED'));

-- BR-34 branch catchment / BR-47 override: `vendors.branch_id` is chosen at
-- onboarding and can later be overridden via a BRANCH_OVERRIDE approval
-- (vendors.service.ts). Recording which branch was actually derived vs.
-- overridden is a nice-to-have the FSD doesn't ask this table to carry — the
-- audit trail (vendor_advance_history's sibling for BRANCH_OVERRIDE is the
-- generic audit_events row the approvals engine already writes) covers it.

-- `vendor_users.user_id` referenced the INTERNAL `users` table — wrong table.
-- part 14 §4.1: "the claim that matters is `sub`, joined to `users.auth_user_id`
-- for internal principals and to `vendor_users.user_id` for transporters" reads
-- those as parallel, independent lookups from the same JWT `sub`, not one
-- table pointing at the other. As written, a transporter would need a `users`
-- row to satisfy the FK — and `SupabaseJwtGuard` (common/guards/supabase-jwt.
-- guard.ts) treats ANY matching `users` row as an internal principal with
-- whatever role that row carries. A vendor row with no role would break the
-- FK; a vendor row WITH one would silently admit a transporter as staff. Both
-- are `ADR-02` §4 violations. Fixed here, before `PortalModule` (not yet
-- built) or this migration's own `vendors.service.ts` activation flow can be
-- written against the wrong shape — nothing queries this table yet (checked).
alter table vendor_users drop constraint vendor_users_pkey;
alter table vendor_users drop constraint vendor_users_user_id_fkey;
alter table vendor_users rename column user_id to auth_user_id;
alter table vendor_users add constraint vendor_users_pkey primary key (auth_user_id);
alter table vendor_users add constraint vendor_users_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete cascade;
