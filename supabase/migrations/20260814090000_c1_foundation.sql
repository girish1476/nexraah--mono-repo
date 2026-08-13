-- C1 · foundation — extensions and shared helpers
-- Part 14 §2. Runs before any table exists.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- Maintains updated_at. Attached to every table carrying the column, at the
-- end of the schema migration. Part 14 §3.
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- audit_events is append-only (NFR-03). The absent GRANT stops internal_api;
-- this stops everything else, including a superuser session that forgot.
create or replace function public.audit_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only (NFR-03): % is not permitted', tg_op;
end
$$;
