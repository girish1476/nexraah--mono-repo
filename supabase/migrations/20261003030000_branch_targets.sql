-- Monthly targets, per branch.
--
-- My desk shows each person what their desk is aiming for this month and this
-- quarter, and how much of it is done. Nothing held a target before this: the
-- achieved figures were always there (loads delivered, freight billed, money
-- collected), but there was no number to hold them against.
--
-- A target belongs to a branch, a month and a measure. An administrator enters
-- it. The quarter is never stored — it is the sum of its three months, so the
-- two can never disagree. Somebody scoped to a branch sees that branch's
-- target; somebody who is not sees the total of every branch.
--
-- `month` is always the first of the month. `target` is a count for LOADS and
-- PODS, and paise for REVENUE, MARGIN and COLLECTIONS.
--
-- Forward-only and idempotent.

create table if not exists branch_targets (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid        not null references branches(id) on delete cascade,
  month       date        not null check (extract(day from month) = 1),
  metric      text        not null check (metric in ('LOADS','REVENUE','MARGIN','COLLECTIONS','PODS')),
  target      bigint      not null check (target >= 0),
  set_by      uuid        references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint branch_targets_one_per_measure unique (branch_id, month, metric)
);

create index if not exists branch_targets_month_idx on branch_targets (month);
