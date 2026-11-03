-- The portal can find the user its uploads are recorded against.
--
-- Every file a transporter uploads (their papers, a POD, a bill) is an
-- `attachments` row, and `uploaded_by` must name a `users` row: the
-- "Portal System" user that 20260824090000 creates. Its id is random per
-- database, and `users` is closed to `vendor_api` by design, so the API could
-- only learn it from a PORTAL_SYSTEM_USER_ID setting that no setup step
-- mentioned. Without it every portal upload failed with "We could not complete
-- that".
--
-- This hands `vendor_api` that one id and nothing else: a definer function
-- over a fixed email, not a grant on the table.

create or replace function public.portal_system_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from users where email = 'portal-system@nexraah.internal'
$$;

revoke all on function public.portal_system_user_id() from public;
grant execute on function public.portal_system_user_id() to vendor_api;
