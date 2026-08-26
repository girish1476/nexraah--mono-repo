-- Merge BRANCH_MGR into OPS and retire the role.
--
-- The branch manager and the operations desk were never separated by what they
-- were allowed to do — they were separated by how much they could see. Every
-- distinct BRANCH_MGR grant (indent.create, the three pod.* verbs,
-- approve.exception, pnl.view_own) is work an operator already does; the only
-- real difference was that a branch manager saw one branch and an operator saw
-- all of them.
--
-- That distinction does not need a role to carry it. `users.branch_id` has
-- existed since the first schema migration: a user with a branch set is scoped
-- to it, a user with none is not. Scoping on the column instead of the role
-- keeps every current person's visibility exactly as it is today while
-- collapsing six roles into five.
--
-- Note on `approve.exception`. OPS inherits it here, which means an operator
-- can approve an ADVANCE_OVERRIDE, ADVANCE_POLICY_CHANGE or DOC_OVERRIDE — the
-- three kinds the approvals registry still labels "Senior to OPS". That label
-- becomes inaccurate with this migration. It is a deliberate product decision,
-- taken with the separation-of-duties cost stated: the second signature on
-- those three kinds may now come from the same desk that raised the request.
-- Compliance and Leadership still hold the permission, so a reviewer *can*
-- still be a different desk — it is simply no longer guaranteed to be.

begin;

-- 1 · OPS inherits every permission BRANCH_MGR held. Where both roles already
--     hold the same permission, keep the stronger level rather than letting
--     the insert order decide.
insert into role_permissions (role_id, permission_id, level)
select ops.id, bmp.permission_id, bmp.level
from roles ops
cross join roles bm
join role_permissions bmp on bmp.role_id = bm.id
where ops.code = 'OPS'
  and bm.code = 'BRANCH_MGR'
on conflict (role_id, permission_id) do update
  set level = case
        when excluded.level = 'EDIT' or role_permissions.level = 'EDIT' then 'EDIT'
        when excluded.level = 'VIEW' or role_permissions.level = 'VIEW' then 'VIEW'
        else 'NONE'
      end,
      updated_at = now();

-- 2 · Everyone who was a branch manager becomes an operator. `branch_id` is
--     deliberately untouched — that column is what scopes them now, so a
--     branch manager keeps precisely the view they had this morning.
update users
set role_id = (select id from roles where code = 'OPS'),
    updated_at = now()
where role_id = (select id from roles where code = 'BRANCH_MGR');

-- 3 · Retire the role. `role_permissions.role_id` cascades, so its grants go
--     with it; `users.role_id` does not cascade, which is why step 2 has to
--     run first and why this statement fails loudly rather than orphaning
--     anyone if it somehow did not.
delete from roles where code = 'BRANCH_MGR';

commit;
