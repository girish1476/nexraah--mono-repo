-- Email one-time-code sign-in, driven by the administrator's allowed-email list.
--
-- The console no longer uses passwords. A person types their email, Supabase
-- emails them a one-time code, and the code signs them in. Who may ask for a
-- code is decided by the `users` table — the "Allowed emails" screen under
-- Settings — and nothing else:
--
--   * Adding a row here creates the matching Supabase Auth login (no
--     password) and links it through `auth_user_id`. The console asks for codes
--     with `create_user: false`, so an email with no login — i.e. one an
--     administrator never allowed — is refused before any email is sent.
--   * Disabling a row bans that login, so no code can be used to sign in;
--     re-enabling lifts the ban. `SupabaseJwtGuard` still rejects DISABLED as
--     well, so a session issued before the ban dies on its next request.
--
-- This runs as the migration owner (security definer) because only it may
-- write `auth.*`. It is the same insert `seed.sql` and `provision.mjs` already
-- make — no service_role key is involved anywhere (part 14 §4 still holds).

create or replace function public.ensure_staff_login(p_email text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_id uuid;
  v_has_provider_id boolean;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is not null then
    return v_id;
  end if;

  v_id := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    lower(p_email), '',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('name', p_name),
    '', '', '', ''
  );

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) into v_has_provider_id;

  if v_has_provider_id then
    execute $i$
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
      values (gen_random_uuid(), $1, $1::text, jsonb_build_object('sub', $1::text, 'email', $2), 'email', now(), now())
    $i$ using v_id, lower(p_email);
  else
    execute $i$
      insert into auth.identities (id, user_id, identity_data, provider, created_at, updated_at)
      values (gen_random_uuid(), $1, jsonb_build_object('sub', $1::text, 'email', $2), 'email', now(), now())
    $i$ using v_id, lower(p_email);
  end if;

  return v_id;
end;
$$;

revoke all on function public.ensure_staff_login(text, text) from public;

-- `*.internal` addresses are system principals (e.g. Portal System), never people.
create or replace function public.users_link_login()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if tg_op = 'INSERT' then
    new.email := lower(trim(new.email));
    if new.auth_user_id is null and new.email not like '%.internal' then
      new.auth_user_id := public.ensure_staff_login(new.email, new.name);
    end if;
  end if;

  if new.auth_user_id is not null and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    update auth.users
       set banned_until = case when new.status = 'DISABLED' then 'infinity'::timestamptz else null end,
           updated_at = now()
     where id = new.auth_user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists users_link_login on users;
create trigger users_link_login
  before insert or update of status on users
  for each row execute function public.users_link_login();

-- Backfill: anyone already on the list without a login gets one now.
do $$
declare
  seat record;
begin
  if to_regclass('auth.users') is null then
    raise notice 'email otp: no auth schema — skipping login backfill';
    return;
  end if;
  for seat in select id, email, name from users where auth_user_id is null and email not like '%.internal' loop
    update users set auth_user_id = public.ensure_staff_login(seat.email, seat.name) where id = seat.id;
  end loop;
end $$;
