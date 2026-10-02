-- Custom roles — an administrator can add a role from Access control.
--
-- The console's screens are laid out per built-in role, so a custom role names
-- the built-in role whose screens it opens (`based_on`) and then carries its
-- own row set in `role_permissions` for what it may actually do there. A role
-- with `based_on` set is a custom role; the built-in ones leave it null.
--
-- Forward-only and idempotent.

alter table roles add column if not exists based_on text references roles(code);
