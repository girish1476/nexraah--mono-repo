-- `document.upload` — uploading documents becomes its own named permission.
--
-- Uploading a trip's documents had no permission of its own: it was allowed to
-- whoever held `document.verify` or `indent.manage`. That made it impossible
-- to let a role upload without also letting it verify documents or manage
-- indents. It is now a row of its own on the Access control screen, attachable
-- to any role (D-17, BR-41 — same footing as `document.verify`).
--
-- Nobody loses anything: every role that could upload before this migration —
-- by holding either of those two at EDIT, as granted in THIS database, not as
-- originally seeded — is given `document.upload` at EDIT. The trip's own
-- loading supervisor still uploads for the trips they are assigned, with no
-- permission needed (checked per trip in `TripsService`).
--
-- Forward-only and idempotent.

insert into permissions (code)
values ('document.upload')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id, level)
select distinct rp.role_id, (select id from permissions where code = 'document.upload'), 'EDIT'
  from role_permissions rp
  join permissions p on p.id = rp.permission_id
 where p.code in ('document.verify', 'indent.manage')
   and rp.level = 'EDIT'
on conflict (role_id, permission_id) do nothing;
