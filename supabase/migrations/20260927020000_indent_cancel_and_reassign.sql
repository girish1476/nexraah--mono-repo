-- Cancelling an indent, reviewing a stale one, and reassigning a transporter.
--
-- 1. A client can cancel a load, so an indent can end CANCELLED. It carries the
--    reason, who cancelled it and when. The trip an award generated for it is
--    cancelled with it (only while the trip has not left and no advance was paid).
--
-- 2. An indent nobody has touched for a week is put in front of Operations and
--    Leadership to cancel or keep, the same day. "Keep" is recorded as a review,
--    so it drops off the list until it has been quiet for another week.
--
-- 3. Leadership can reassign the transporter on an awarded load. The trip keeps
--    its number: it is set aside (CANCELLED) and comes back to life, for the new
--    transporter, when the next quote is accepted. Reassigning the *truck* is
--    Operations' own "change vehicle" and needs no new state.
--
-- 4. An order can now also end CANCELLED.
--
-- Forward-only and idempotent.

alter table indents
  add column if not exists cancel_reason     text,
  add column if not exists cancelled_at      timestamptz,
  add column if not exists cancelled_by      uuid references users(id),
  add column if not exists last_reviewed_at  timestamptz;

alter table indents drop constraint if exists indents_stage_check;
alter table indents add constraint indents_stage_check
  check (stage in ('OPEN','VENDOR_ASSIGNED','VEHICLE_PLACED','TRIP_CREATED','CANCELLED'));

alter table trips drop constraint if exists trips_stage_check;
alter table trips add constraint trips_stage_check
  check (stage in ('OPEN','IN_TRANSIT','DELIVERED','CLOSED','CANCELLED'));

-- Orders: one more terminal status. Rebuilt from whatever the constraint holds
-- now, so a status added by an earlier migration is not lost.
do $$
declare
  existing text;
  def text;
begin
  select conname, pg_get_constraintdef(oid) into existing, def
    from pg_constraint
   where conrelid = 'orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%POD_FORFEITED%'
   limit 1;
  if existing is not null and def not ilike '%CANCELLED%' then
    execute format('alter table orders drop constraint %I', existing);
    execute format('alter table orders add constraint %I %s', existing,
      replace(def, '''POD_FORFEITED''', '''POD_FORFEITED'', ''CANCELLED'''));
  end if;
end $$;

-- Reassigning is Leadership's call.
insert into permissions (code) values ('indent.reassign') on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id, level)
select r.id, p.id, 'EDIT'
from roles r
join permissions p on p.code = 'indent.reassign'
where r.code in ('LEADERSHIP', 'ADMIN')
on conflict (role_id, permission_id) do update set level = 'EDIT', updated_at = now();
