-- SDR: shortage / damage records, and carrying an unpaid deduction forward.
--
-- A delivery can come back short, damaged, or with the receiver refusing to
-- acknowledge the unloading. Whoever checks the proof of delivery records that
-- as an SDR against the trip. While an SDR is open the transporter's balance
-- for that trip is on hold.
--
-- Resolving an SDR fixes the amount to deduct from the transporter. The balance
-- is then paid after that deduction. Where the deduction is larger than the
-- balance there is nothing left to take it from, so the remainder stays
-- `outstanding` on the SDR and is deducted, in small pieces, from the
-- transporter's next balance payments until it is cleared. Every piece that is
-- taken is written to `sdr_recoveries`, so the trail says which trip's payment
-- paid down which record.
--
-- Forward-only and idempotent.

insert into number_series (key, prefix, next_value, width, scope, branch_id)
select 'SDR', 'SDR-', 1, 4, 'GLOBAL', null
where not exists (select 1 from number_series where key = 'SDR' and branch_id is null);

create table if not exists sdr_records (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,
  trip_id       uuid        not null references trips(id),
  vendor_id     uuid        not null references vendors(id),
  kind          text        not null check (kind in ('SHORTAGE','DAMAGE','UNLOADING_ACK')),
  description   text        not null,
  -- What the person raising it believes it costs. The deduction is decided at
  -- resolution and may differ.
  claimed_amount bigint     not null default 0 check (claimed_amount >= 0),
  status        text        not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  -- Set at resolution. `outstanding` is what has not yet been taken from a
  -- payment; it only ever goes down.
  deduction     bigint      check (deduction >= 0),
  outstanding   bigint      not null default 0 check (outstanding >= 0),
  resolution_note text,
  raised_by     uuid        not null references users(id),
  raised_at     timestamptz not null default now(),
  resolved_by   uuid        references users(id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint sdr_resolved_has_deduction
    check ((status = 'OPEN' and deduction is null) or (status = 'RESOLVED' and deduction is not null))
);

create index if not exists sdr_records_trip_idx on sdr_records (trip_id);
create index if not exists sdr_records_vendor_outstanding_idx
  on sdr_records (vendor_id) where status = 'RESOLVED' and outstanding > 0;

create table if not exists sdr_recoveries (
  id          uuid primary key default gen_random_uuid(),
  sdr_id      uuid        not null references sdr_records(id),
  -- The trip whose balance payment the amount was taken from.
  trip_id     uuid        not null references trips(id),
  payment_id  uuid        not null references payments(id),
  amount      bigint      not null check (amount > 0),
  created_at  timestamptz not null default now()
);

create index if not exists sdr_recoveries_sdr_idx on sdr_recoveries (sdr_id);

-- `payments.net` was `gross - penalty`. A recovered deduction reduces what is
-- paid too, so it joins the formula. Guarded so a re-run does nothing.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'payments' and column_name = 'deduction'
  ) then
    alter table payments add column deduction bigint not null default 0 check (deduction >= 0);
    alter table payments drop column net;
    alter table payments add column net bigint generated always as (gross - penalty - deduction) stored;
  end if;
end $$;
