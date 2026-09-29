-- Per-lane transit penalty, and the mail evidence behind every rate.
--
-- 1. Transit penalty varies by lane and truck type, so it is set when the rate
--    is entered: whether it applies, and if so how much a late day costs. A lane
--    that applies it must carry an amount.
--
-- 2. A rate is only entered once BD and Leadership have agreed it by mail, so
--    the mail's subject (and, when there is one, its screenshot) is recorded on
--    the lane and on the revision that produced it.
--
-- Forward-only and idempotent.

alter table rate_card_lanes
  add column if not exists transit_penalty_applies boolean not null default false,
  add column if not exists transit_penalty_per_day bigint  not null default 0
    check (transit_penalty_per_day >= 0),
  add column if not exists approval_mail_subject   text,
  add column if not exists approval_mail_attachment_id uuid references attachments(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rate_card_lanes_penalty_has_amount') then
    alter table rate_card_lanes
      add constraint rate_card_lanes_penalty_has_amount
      check (not transit_penalty_applies or transit_penalty_per_day > 0);
  end if;
end $$;

alter table rate_revisions
  add column if not exists approval_mail_subject text,
  add column if not exists approval_mail_attachment_id uuid references attachments(id),
  -- A revision may also change the penalty; null means "carry the lane's across".
  add column if not exists transit_penalty_applies boolean,
  add column if not exists transit_penalty_per_day bigint check (transit_penalty_per_day is null or transit_penalty_per_day >= 0);

-- 3. A pricing person enters rates too. Finance (accounts receivable) already
--    holds `rate.revise`; BD does as well, since it is the desk that prices the
--    lane. Neither approves a rate — Compliance signs it off, against the BD and
--    Leadership approval mail recorded above — so nobody countersigns their own.
insert into role_permissions (role_id, permission_id, level)
select r.id, p.id, 'EDIT'
from roles r
join permissions p on p.code = 'rate.revise'
where r.code = 'BD'
on conflict (role_id, permission_id) do update
  set level = 'EDIT', updated_at = now();
