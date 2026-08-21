-- C1 · correction — split `indent.create` into raise vs. manage
--
-- `indent.create` gated both the intake step (`POST /indents`) and the whole
-- execution lifecycle after it (award, placement, trip creation, advance %
-- change) under one code. Operations desk raised the indent and ran it end
-- to end; Compliance only viewed it.
--
-- Ownership changed: raising an indent is now Compliance's job (a gate on
-- intake), while awarding a vendor, recording placement, creating the trip
-- and setting the advance % stay with Operations (and Branch manager, who
-- already ran the same lifecycle for their own branch) — that is execution,
-- not intake, and Operations still owns awards/placement/transit per part 01
-- §2.1. Splitting the permission is what lets the two move independently:
-- `indent.create` now means only "raise", and the new `indent.manage` covers
-- everything after that.
--
-- `document.verify` moves off Operations entirely — trip-document
-- verification and the cross-check are now Compliance-only, same as vendor
-- document verification already was.

insert into permissions (code)
values ('indent.manage')
on conflict (code) do nothing;

do $$
declare
  ops_id uuid;
  compliance_id uuid;
  branch_mgr_id uuid;
  indent_create_id uuid;
  indent_manage_id uuid;
  document_verify_id uuid;
begin
  select id into ops_id from roles where code = 'OPS';
  select id into compliance_id from roles where code = 'COMPLIANCE';
  select id into branch_mgr_id from roles where code = 'BRANCH_MGR';
  select id into indent_create_id from permissions where code = 'indent.create';
  select id into indent_manage_id from permissions where code = 'indent.manage';
  select id into document_verify_id from permissions where code = 'document.verify';

  -- OPS: raising and verifying move away; managing an already-raised indent
  -- (award/placement/trip/advance %) and uploading trip documents stay.
  delete from role_permissions where role_id = ops_id and permission_id = indent_create_id;
  delete from role_permissions where role_id = ops_id and permission_id = document_verify_id;
  insert into role_permissions (role_id, permission_id, level)
  values (ops_id, indent_manage_id, 'EDIT')
  on conflict (role_id, permission_id) do update set level = excluded.level;

  -- COMPLIANCE: gains the raise step, keeps document.verify (unchanged).
  insert into role_permissions (role_id, permission_id, level)
  values (compliance_id, indent_create_id, 'EDIT')
  on conflict (role_id, permission_id) do update set level = excluded.level;

  -- BRANCH_MGR already raises for its own branch (unaffected) and already
  -- ran the same lifecycle actions under the old combined permission —
  -- gains indent.manage so that continues to work post-split.
  insert into role_permissions (role_id, permission_id, level)
  values (branch_mgr_id, indent_manage_id, 'EDIT')
  on conflict (role_id, permission_id) do update set level = excluded.level;
end $$;
