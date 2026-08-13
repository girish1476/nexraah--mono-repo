-- C1 · reference seed — part 14 §10, content from internal-spec/01-C1 §4 and §6
--
-- Idempotent by design: this runs on every deploy, keyed on `code`. Reference
-- data is a migration rather than a script so it is versioned with the schema
-- that needs it.

-- ─────────────────────────────────────────────────────────────
-- Roles — the six the FSD names, plus the transporter audience
-- ─────────────────────────────────────────────────────────────

insert into roles (code, name, is_system) values
  ('OPERATIONS',   'Operations',    true),
  ('COMPLIANCE',   'Compliance',    true),
  ('FINANCE',      'Finance',       true),
  ('BRANCH_MGR',   'Branch manager',true),
  ('LEADERSHIP',   'Leadership',    true),
  ('ADMIN',        'Administrator', true)
on conflict (code) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Permissions
-- ─────────────────────────────────────────────────────────────

insert into permissions (code)
select unnest(array[
  'indent.create', 'indent.award',
  'vendor.create', 'vendor.activate',
  'document.verify',
  'pod.upload', 'pod.verify', 'pod.approve', 'pod.waive',
  'payment.release',
  'invoice.create', 'receipt.record',
  'rfq.manage', 'ratecard.manage',
  'report.view', 'pnl.view',
  'admin.roles', 'admin.config', 'admin.import',
  'approve.above_band', 'approve.advance_override', 'approve.penalty_waiver',
  'approve.doc_override', 'approve.branch_override', 'approve.advance_policy',
  -- Portal audience. `portal.self` is every read and most writes; the other two
  -- are separated because they are the two a suspended vendor loses first.
  'portal.self', 'portal.bill'
])
on conflict (code) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Number series — BR-14, NFR-08
-- ─────────────────────────────────────────────────────────────

insert into number_series (key, prefix, next_value, width, scope) values
  ('vendor',        'VND-',     1, 4, 'GLOBAL'),
  ('lead',          'LD-',      1, 4, 'GLOBAL'),
  ('issue',         'IS-',      1, 4, 'GLOBAL'),
  ('client',        'CLT-',     1, 4, 'GLOBAL'),
  ('indent',        'IND-',  4400, 4, 'GLOBAL'),
  ('quote',         'BID-',     1, 5, 'GLOBAL'),
  ('trip',          'TRP-',     1, 5, 'GLOBAL'),
  ('lorry_receipt', 'LR-',      1, 6, 'GLOBAL'),
  ('pod_receipt',   'PDR-',     1, 5, 'GLOBAL'),
  ('invoice',       'NEX-INV-', 1, 5, 'GLOBAL'),
  ('receipt',       'RCT-',     1, 5, 'GLOBAL')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Config — BR-24, BR-25, BR-34, BR-58
-- ─────────────────────────────────────────────────────────────

insert into config (key, value) values
  ('pod.penalty_per_day_paise',  '10000'::jsonb),          -- BR-24, ₹100/day
  ('pod.penalty_start_day',      '21'::jsonb),             -- BR-24, from day 21
  ('pod.forfeiture_day',         '40'::jsonb),             -- BR-25, nothing payable
  ('pod.breach_day',             '20'::jsonb),             -- BR-12
  ('branch.catchment_km',        '150'::jsonb),            -- BR-34
  ('invoice.tax_mechanism',      '"REVERSE_CHARGE"'::jsonb),
  -- BR-58: the eight-document advance set, configurable
  ('advance.document_set', '[
     "RC","DRIVING_LICENCE","EWAY_BILL","LR","LOADING_SLIP",
     "WEIGHMENT_SLIP","INSURANCE","PAN"
   ]'::jsonb),
  -- The eleven trip documents. trip_documents.kind is validated against this
  -- rather than a CHECK, because it is meant to change without a migration.
  ('trip.document_kinds', '[
     "LR","EWAY_BILL","LOADING_SLIP","WEIGHMENT_SLIP","INVOICE",
     "RC","DRIVING_LICENCE","INSURANCE","PERMIT","FITNESS","POD"
   ]'::jsonb)
on conflict (key) do nothing;
