-- C1 · correction — role_permissions, permission codes, config seed, number series
--
-- Forward-only (part 14 §2): 090300 seeded `permissions` and `config` with codes
-- that do not match the real contract. The authoritative permission list is
-- `apps/internal-portal/src/lib/permissions.ts` (part 01 §2.4, mirrored there
-- verbatim per its own header comment) — it is what `GET /auth/session` must
-- return and what every `@RequirePermission(...)` guard checks against. This
-- migration also fills the gap 090300 left open: `role_permissions` was never
-- populated, so no role held any grant.
--
-- `number_series` gets a real primary key here too. `key text primary key`
-- cannot hold more than one `POD_RECEIPT` row, and part 01 §4.1 requires one
-- per branch. Nothing references `number_series(key)` by foreign key yet, so
-- the swap is safe.

-- ─────────────────────────────────────────────────────────────
-- 1 · Permission codes — replace the invented set with the real one
-- ─────────────────────────────────────────────────────────────

delete from permissions where code in (
  'indent.award','vendor.create','pod.upload','rfq.manage','ratecard.manage',
  'report.view','pnl.view','admin.roles','admin.config','admin.import',
  'approve.advance_override','approve.penalty_waiver','approve.doc_override',
  'approve.branch_override','approve.advance_policy'
);
-- role_permissions is empty at this point (never seeded — see §3), so the
-- delete above has nothing depending on it to break.

insert into permissions (code)
select unnest(array[
  'payment.release','indent.create','indent.view','document.verify',
  'vendor.edit','vendor.verify','vendor.activate','vendor.advance_policy',
  'pod.receive','pod.verify','pod.approve','pod.waive',
  'rfq.submit','rfq.edit',
  'invoice.create','receipt.record',
  'config.manage',
  'approve.above_band','approve.waiver','approve.exception','approve.contract',
  'pnl.view_all','pnl.view_own'
  -- 'portal.self','portal.bill' dropped: the portal surface authorises via
  -- vendor_users + the service key (ADR-02 §4), never via role_permissions.
])
on conflict (code) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 2 · Fixed permissions — BR-40, BR-43, the rest of §2.4
-- ─────────────────────────────────────────────────────────────
--
-- Not schema-enforced here (the PATCH handler owns 409 PERMISSION_FIXED); this
-- table just makes "which four, and whose" queryable instead of hard-coded in
-- two places.

create table permission_fixed_owners (
  permission_code text primary key references permissions(code),
  owner_role_code text not null references roles(code)
);

insert into permission_fixed_owners (permission_code, owner_role_code) values
  ('payment.release', 'FINANCE'),
  ('pod.waive',       'COMPLIANCE'),
  ('rfq.submit',      'LEADERSHIP'),
  ('config.manage',   'ADMIN')
on conflict (permission_code) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 3 · role_permissions — the seed grants, part 01 §2.4
-- ─────────────────────────────────────────────────────────────
--
-- Absence of a row means NONE; PermissionsService treats a missing grant that
-- way rather than requiring 6 × 23 explicit NONE rows. Every row inserted here
-- is EDIT — the flat permission model has no meaningful VIEW state distinct
-- from holding the code at all (the `*.view` and `pnl.view_*` codes exist
-- precisely because "view" is its own capability, not a level of another one).

do $$
declare
  grants jsonb := '{
    "OPS":         ["indent.create","indent.view","document.verify","vendor.edit","rfq.edit"],
    "COMPLIANCE":  ["indent.view","document.verify","vendor.verify","vendor.activate",
                     "vendor.advance_policy","pod.receive","pod.verify","pod.approve",
                     "pod.waive","approve.contract","approve.exception"],
    "FINANCE":     ["payment.release","invoice.create","receipt.record","pnl.view_all","indent.view"],
    "BRANCH_MGR":  ["indent.create","indent.view","rfq.edit","pod.receive","pod.verify",
                     "pod.approve","approve.exception","pnl.view_own"],
    "LEADERSHIP":  ["indent.view","rfq.submit","approve.above_band","approve.waiver",
                     "approve.exception","pnl.view_all"],
    "ADMIN":       ["config.manage"]
  }'::jsonb;
  role_code text;
  perm_code text;
begin
  for role_code in select jsonb_object_keys(grants) loop
    for perm_code in select jsonb_array_elements_text(grants -> role_code) loop
      insert into role_permissions (role_id, permission_id, level)
      select r.id, p.id, 'EDIT'
        from roles r, permissions p
       where r.code = role_code and p.code = perm_code
      on conflict (role_id, permission_id) do update set level = excluded.level;
    end loop;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 4 · config — replace the dotted, partial keys with the real GET /config shape
-- ─────────────────────────────────────────────────────────────
--
-- docs/api/01-foundation.md's example response is the seed: every key below is
-- a top-level field of the object `GET /config` returns, so the settings
-- service can assemble it with one `select key, value from config where key
-- not like '%.%'`. `trip.document_kinds` keeps its dot on purpose — it is an
-- internal lookup (trip_documents.kind validation), not part of that object,
-- and the `not like '%.%'` filter is what keeps it out of the response.

delete from config where key in (
  'pod.penalty_per_day_paise','pod.penalty_start_day','pod.forfeiture_day',
  'pod.breach_day','branch.catchment_km','invoice.tax_mechanism','advance.document_set'
);

insert into config (key, value) values
  ('modules', '{"rfq": true, "telematics": true, "invoicing": true, "import": true}'::jsonb),
  ('kyc_strict_gate', 'true'::jsonb),
  ('kyc_route', '"MANUAL"'::jsonb),
  -- BR-58: the eight-document advance set, exactly as 00-conventions §6 / part 01 §4.2 name it.
  ('advance_document_set', '["CLIENT_INVOICE_OR_PO","EWAY_BILL","RC","INSURANCE","FITNESS","PERMIT","PUC","DRIVING_LICENCE"]'::jsonb),
  ('advance_default_pct', '40'::jsonb),
  ('credit_default_days', '45'::jsonb),
  ('sla_hours', '24'::jsonb),
  ('pod_tat_days', '20'::jsonb),                       -- BR-12
  ('pod_penalty_per_day_paise', '10000'::jsonb),        -- BR-24, ₹100/day
  ('pod_forfeit_days', '40'::jsonb),                    -- BR-25
  ('eway_warning_window_hours', '12'::jsonb),
  ('overspeed_kmph', '80'::jsonb),
  ('halt_minutes', '90'::jsonb),
  ('dark_vehicle_interval_minutes', '120'::jsonb),
  ('minimum_margin_pct', '8'::jsonb),
  ('branch_catchment_km', '150'::jsonb),                -- BR-34
  ('company', '{
     "name": "Nexraah Logistics Private Limited",
     "gstin": "27AABCN4471K1ZV",
     "pan": "AABCN4471K",
     "cin": "U63030MH2019PTC332211",
     "address": "Plot 44, MIDC Ambad, Nashik 422010, Maharashtra",
     "bank": "HDFC Bank · Nashik · A/c 50200044714471 · IFSC HDFC0000188"
   }'::jsonb)
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 5 · number_series — real primary key, correct keys, the missing CUSTOMER series
-- ─────────────────────────────────────────────────────────────

alter table number_series drop constraint number_series_pkey;
alter table number_series add column id uuid not null default gen_random_uuid();
alter table number_series add constraint number_series_pkey primary key (id);
-- GLOBAL rows are unique by key alone; BRANCH rows (POD_RECEIPT) are unique per
-- (key, branch_id) — one series per branch, not one series total.
create unique index number_series_key_branch_uidx on number_series (key, branch_id) nulls not distinct;

delete from number_series where key in
  ('vendor','lead','issue','client','indent','quote','trip','lorry_receipt','pod_receipt','invoice','receipt');

-- docs/api/01-foundation.md §GET /config/number-series: key ∈ TRIP · LR ·
-- INVOICE · INDENT · VENDOR · CLIENT · CUSTOMER · POD_RECEIPT · QUOTE ·
-- RECEIPT · LEAD · ISSUE. POD_RECEIPT is deliberately absent from this GLOBAL
-- batch — part 01 §4.1 makes it per-branch, and no branch exists yet at C1.
-- BranchesService creates a POD_RECEIPT row (scope BRANCH, that branch's id)
-- whenever a branch is created; supabase/seed.sql does the same for its two
-- local fixture branches.
insert into number_series (key, prefix, next_value, width, scope, branch_id) values
  ('TRIP',    'TRP-',     100241, 6, 'GLOBAL', null),
  ('LR',      'LR-',       88215, 5, 'GLOBAL', null),
  ('INVOICE', 'NEX-INV-',      1, 6, 'GLOBAL', null),
  ('INDENT',  'IND-',       4468, 4, 'GLOBAL', null),
  ('VENDOR',  'VND-',          1, 4, 'GLOBAL', null),
  ('CLIENT',  'CLT-',          1, 4, 'GLOBAL', null),
  ('CUSTOMER','CUS-',          1, 4, 'GLOBAL', null),
  ('QUOTE',   'BID-',          1, 5, 'GLOBAL', null),
  ('RECEIPT', 'RCT-',          1, 5, 'GLOBAL', null),
  ('LEAD',    'LD-',           1, 4, 'GLOBAL', null),
  ('ISSUE',   'IS-',           1, 4, 'GLOBAL', null);
