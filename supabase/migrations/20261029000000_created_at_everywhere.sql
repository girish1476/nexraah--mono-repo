-- Part 14 §11: every table carries `created_at`. Three did not — the two
-- append-only logs, which record their moment in `at`, and the fixed-owners
-- reference table — so supabase/tests/grants.sql §7 failed on a fresh
-- database. Nothing reads the new column; it is there so the rule has no
-- exceptions to remember.
--
-- A default rather than a backfill from `at`: this runs before go-live, on
-- tables that are empty or hold only reference rows.

alter table permission_fixed_owners add column if not exists created_at timestamptz not null default now();
alter table audit_events add column if not exists created_at timestamptz not null default now();
alter table order_events add column if not exists created_at timestamptz not null default now();
