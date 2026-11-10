-- Transporter portal logins, made from the console.
--
-- A transporter signs in to the portal with an email and password — a Supabase
-- Auth account linked to the transporter by `vendor_users`. Until now the only
-- thing that made one was `supabase/scripts/provision.mjs`, run by hand as the
-- database owner, so activating a transporter left them with no way in
-- (`vendor-portal-account.service.ts` recorded the step as pending). On
-- pre-prod, 10 Nov 2026, no transporter had a login at all.
--
-- The API never holds Supabase's service_role key — `config/env.ts` refuses to
-- boot with one, since it bypasses every grant the design rests on. So these
-- are three narrow definer functions instead, the same rows provision.mjs
-- writes and nothing more: create one transporter's login, reset its
-- password, read which email it is. `internal_api` may execute them; nobody
-- else may, and `internal_api` still has no grant on the auth schema itself.
--
-- Refusals are raised with a stable message the API turns into words:
--   PORTAL_LOGIN_BAD_EMAIL, PORTAL_LOGIN_WEAK_PASSWORD, PORTAL_LOGIN_NO_VENDOR,
--   PORTAL_LOGIN_EXISTS, PORTAL_LOGIN_STAFF_EMAIL, PORTAL_LOGIN_EMAIL_TAKEN,
--   PORTAL_LOGIN_NONE.

create or replace function public.portal_login_create(p_vendor_id uuid, p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text;
  v_auth uuid;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'PORTAL_LOGIN_BAD_EMAIL';
  end if;
  if length(coalesce(p_password, '')) < 10 then
    raise exception 'PORTAL_LOGIN_WEAK_PASSWORD';
  end if;
  select legal_name into v_name from public.vendors where id = p_vendor_id;
  if not found then
    raise exception 'PORTAL_LOGIN_NO_VENDOR';
  end if;
  if exists (select 1 from public.vendor_users where vendor_id = p_vendor_id) then
    raise exception 'PORTAL_LOGIN_EXISTS';
  end if;
  -- One address, one account: a staff sign-in, or anyone else's, would hand
  -- that person this transporter's portal.
  if exists (select 1 from public.users where lower(email) = v_email) then
    raise exception 'PORTAL_LOGIN_STAFF_EMAIL';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'PORTAL_LOGIN_EMAIL_TAKEN';
  end if;

  v_auth := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', v_auth, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', v_name), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
  values (gen_random_uuid(), v_auth, v_auth::text, jsonb_build_object('sub', v_auth::text, 'email', v_email), 'email', now(), now());
  insert into public.vendor_users (auth_user_id, vendor_id) values (v_auth, p_vendor_id);
  -- Notices go to "Email for notices"; until one is set, the sign-in address works.
  update public.vendors set email = v_email where id = p_vendor_id and email is null;
  return v_auth;
end;
$$;

create or replace function public.portal_login_reset(p_vendor_id uuid, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_email text;
begin
  if length(coalesce(p_password, '')) < 10 then
    raise exception 'PORTAL_LOGIN_WEAK_PASSWORD';
  end if;
  update auth.users au
     set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
    from public.vendor_users vu
   where vu.vendor_id = p_vendor_id and au.id = vu.auth_user_id
  returning au.email into v_email;
  if v_email is null then
    raise exception 'PORTAL_LOGIN_NONE';
  end if;
  return v_email;
end;
$$;

create or replace function public.portal_login_email(p_vendor_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select au.email from public.vendor_users vu join auth.users au on au.id = vu.auth_user_id
   where vu.vendor_id = p_vendor_id
   order by vu.created_at
   limit 1
$$;

-- Named as well as public: Supabase can grant new functions to anon and
-- authenticated by default, and either could then reach these through the
-- REST API's rpc endpoint.
revoke all on function public.portal_login_create(uuid, text, text) from public, anon, authenticated;
revoke all on function public.portal_login_reset(uuid, text) from public, anon, authenticated;
revoke all on function public.portal_login_email(uuid) from public, anon, authenticated;
grant execute on function public.portal_login_create(uuid, text, text) to internal_api;
grant execute on function public.portal_login_reset(uuid, text) to internal_api;
grant execute on function public.portal_login_email(uuid) to internal_api;
