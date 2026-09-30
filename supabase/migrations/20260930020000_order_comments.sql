-- Comments on an order.
--
-- The order page's Comments tab only ever showed the remarks typed when the
-- load was raised, and nobody could add to it. Operations asked for a small
-- comment button where remarks and details can be entered as the load moves —
-- "driver called, arriving 6pm", "consignee closed on Sunday".
--
-- Append-only: a comment is a note of what somebody said at the time, so it
-- is never edited or deleted. Internal only — `vendor_api` is granted nothing
-- here (new tables reach `internal_api` only, by the default privileges in
-- 20260814090200_c1_roles_grants.sql), so a transporter can never read them.
--
-- Forward-only and idempotent.

create table if not exists order_comments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid        not null references orders(id) on delete cascade,
  author_user_id uuid        not null references users(id),
  body           text        not null check (length(btrim(body)) between 1 and 2000),
  created_at     timestamptz not null default now()
);

create index if not exists order_comments_order_idx on order_comments (order_id, created_at);
