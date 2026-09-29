-- Penalty waivers on record, and a floor under every balance payment.
--
-- 1. Any penalty can be waived: the paperwork (POD) penalty, the late-delivery
--    (transit) penalty, and what is still owed on an SDR. Leadership agrees a
--    waiver by mail; Compliance records it. So a waiver is a row that carries the
--    mail's subject (and, when there is one, its screenshot) and who recorded it.
--
-- 2. A balance payment never goes to nothing. Deductions may take all but a small
--    residual, which is always paid; the rest stays outstanding and is recovered
--    from the transporter's next payments. The residual is a config value and is
--    kept below one hundred rupees.
--
-- Forward-only and idempotent.

create table if not exists penalty_waivers (
  id            uuid primary key default gen_random_uuid(),
  kind          text        not null check (kind in ('POD_PENALTY','TRANSIT_PENALTY','SDR_RECOVERY')),
  trip_id       uuid        not null references trips(id),
  sdr_id        uuid        references sdr_records(id),
  amount        bigint      not null default 0 check (amount >= 0),
  mail_subject  text        not null,
  mail_attachment_id uuid   references attachments(id),
  note          text,
  waived_by     uuid        not null references users(id),
  created_at    timestamptz not null default now()
);

create index if not exists penalty_waivers_trip_idx on penalty_waivers (trip_id);

alter table trips
  add column if not exists transit_penalty_waived boolean not null default false;

alter table sdr_records
  add column if not exists waived bigint not null default 0 check (waived >= 0);

insert into config (key, value)
values ('min_balance_payable_paise', '5000'::jsonb)
on conflict (key) do nothing;
