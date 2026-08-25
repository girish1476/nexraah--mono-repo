-- C2 · correction — Branch Manager was missing `vendor.edit`
--
-- The frontend's own seed (apps/internal-portal/src/lib/permissions.ts,
-- SEED_GRANTS.BRANCH_MGR and MODULE_ACCESS.vendors) has always granted
-- BRANCH_MGR edit access to the Transporters module, and e2e/rbac-nav.spec.ts
-- asserts /vendors is in their nav — a deliberate, tested product decision.
-- Neither `role_permissions` (20260814090400_c1_role_permissions_and_config.sql
-- §3) nor its hard-coded mirror (roles.constants.ts) ever granted the matching
-- `vendor.edit` permission, so a Branch Manager could open the vendor list
-- against the real backend but every mutating control on it (add a
-- transporter, edit a draft) was invisible — a Branch Manager cannot run
-- their branch's own supply without this. This was invisible against mocks,
-- which read grants from the frontend's own copy of the seed.

do $$
declare
  branch_mgr_id uuid;
  vendor_edit_id uuid;
begin
  select id into branch_mgr_id from roles where code = 'BRANCH_MGR';
  select id into vendor_edit_id from permissions where code = 'vendor.edit';

  insert into role_permissions (role_id, permission_id, level)
  values (branch_mgr_id, vendor_edit_id, 'EDIT')
  on conflict (role_id, permission_id) do update set level = excluded.level;
end $$;
