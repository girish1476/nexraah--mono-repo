-- Administrator holds every permission (owner's direction, 2026-09-26).
--
-- Until now ADMIN was deliberately short of eight permissions: the fixed
-- payment.release / pod.waive / rfq.submit (BR-40, BR-43) and the four
-- approve.* decisions, plus pnl.view_own. The owner asked for an administrator
-- who can do every operation, so they are granted here.
--
-- permission_fixed_owners is left exactly as it is. It only makes the PATCH
-- /admin/roles handler refuse to hand these to a *further* role; it never
-- stopped a seed row, and it still should not.
--
-- Idempotent — safe to re-run.

insert into role_permissions (role_id, permission_id, level)
select r.id, p.id, 'EDIT'
from roles r
cross join permissions p
where r.code = 'ADMIN'
  and p.code in (
    'payment.release', 'pod.waive', 'rfq.submit',
    'approve.above_band', 'approve.waiver', 'approve.exception', 'approve.contract',
    'pnl.view_own'
  )
on conflict do nothing;
