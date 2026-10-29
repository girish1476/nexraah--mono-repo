-- An administrator can do every operation (2026-09-26), and the console and
-- the API's role table both say so: roles.constants.ts SEED_GRANTS.ADMIN, kept
-- equal to the portal's permissions.ts by permissions-drift.test.ts.
--
-- The database is the copy the API actually checks, and nothing compared it:
-- 20260926000000 added eight permissions and missed these sixteen, so on a real
-- database an administrator was refused My desk, All orders and every payment
-- screen ("Missing permission: indent.view"). Found 29 Oct 2026, the first time
-- the console ran against a real database. supabase/scripts/check-grants.mjs
-- now compares the two after every migration.

insert into role_permissions (role_id, permission_id, level)
select r.id, p.id, 'EDIT'
from roles r
cross join permissions p
where r.code = 'ADMIN'
  and p.code in (
    'indent.create', 'indent.manage', 'indent.view',
    'document.upload', 'document.verify',
    'vendor.edit', 'vendor.verify', 'vendor.activate', 'vendor.advance_policy',
    'pod.receive', 'pod.verify', 'pod.approve',
    'rfq.edit', 'invoice.create', 'receipt.record', 'pnl.view_all'
  )
on conflict do nothing;
