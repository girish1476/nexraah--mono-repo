-- C1 · correction — gate client-record create/edit on a real permission
--
-- `clients.controller.ts` shipped with no `@RequirePermission` on POST/PATCH
-- at all: `role_permissions` never had a code that fit (FINANCE is the only
-- EDIT role on the `clients` module per MODULE_ACCESS, but its existing
-- grants — invoice.create, receipt.record — are billing actions, not
-- client-master ones). Any authenticated internal principal could create or
-- edit a client record regardless of role. This adds the missing code and
-- seeds it to FINANCE (the module's designated owner) and ADMIN (holds
-- every non-fixed permission by design, part 01 §2.4).

insert into permissions (code)
values ('client.manage')
on conflict (code) do nothing;

do $$
declare
  finance_id uuid;
  admin_id uuid;
  client_manage_id uuid;
begin
  select id into finance_id from roles where code = 'FINANCE';
  select id into admin_id from roles where code = 'ADMIN';
  select id into client_manage_id from permissions where code = 'client.manage';

  insert into role_permissions (role_id, permission_id, level)
  values (finance_id, client_manage_id, 'EDIT')
  on conflict (role_id, permission_id) do update set level = excluded.level;

  insert into role_permissions (role_id, permission_id, level)
  values (admin_id, client_manage_id, 'EDIT')
  on conflict (role_id, permission_id) do update set level = excluded.level;
end $$;
