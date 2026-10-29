-- Notifications that are actually sent: email, browser push, and SMS once a
-- gateway is named.
--
-- `notifications` (20260814090100) was a queue the `notification-dispatch` job
-- marked SENT without sending anything. Delivery needs a little more than a
-- status: how many tries, why the last one failed, when to try again, and a key
-- that stops one event being queued twice when a job runs again.

alter table notifications add column if not exists attempts         integer     not null default 0;
alter table notifications add column if not exists last_error       text;
alter table notifications add column if not exists next_attempt_at  timestamptz;
alter table notifications add column if not exists claimed_at       timestamptz;
-- One row per event, channel and recipient. A re-run of the job that raised it
-- (a POD reminder sweep, say) finds the key taken and adds nothing.
alter table notifications add column if not exists dedupe_key       text;
create unique index if not exists notifications_dedupe_key on notifications (dedupe_key);
create index if not exists notifications_due on notifications (status, next_attempt_at);

-- Browser push: one row per browser that said yes to notifications. A person
-- with the console open on a laptop and a phone has two. Exactly one of
-- `user_id` (staff) and `vendor_id` (a transporter, through the portal) is set.
create table if not exists push_subscriptions (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        references users(id)   on delete cascade,
  vendor_id       uuid        references vendors(id) on delete cascade,
  endpoint        text        not null unique,
  p256dh          text        not null,
  auth            text        not null,
  user_agent      text,
  last_sent_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint push_subscriptions_one_owner check ((user_id is null) <> (vendor_id is null))
);
create index if not exists push_subscriptions_user on push_subscriptions (user_id);
create index if not exists push_subscriptions_vendor on push_subscriptions (vendor_id);

grant select, insert, update, delete on push_subscriptions to internal_api;
-- The portal registers and removes its own browsers, through vendor_api. Which
-- vendor a row belongs to is set by the portal from the signed-in login, never
-- taken from the request (portal-push.repository.ts).
grant select, insert, update, delete on push_subscriptions to vendor_api;

-- A transporter's email, for notifications. Optional: many have none, and the
-- mobile number stays the main contact.
alter table vendors add column if not exists email text;
