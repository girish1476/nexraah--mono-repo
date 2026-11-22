-- Opening balances (part 12, the third go-live set) — what was owed on the day
-- Nexraah took over: open client invoices, trips run but not yet billed, and
-- advances paid to transporters against trips not yet settled.
--
-- They get a table of their own rather than being written as invoices, trips
-- or payments. Those tables need things an opening-balance line does not have
-- (line totals and GST, a truck and a route, a UTR and value date), and making
-- them up would put invented records into the money tables on day one. Here a
-- balance is exactly what the file said: who, which old reference, how much,
-- since when — and whether it has since been settled.
--
-- Every row carries the import batch that brought it in (part 12 §2), so a bad
-- file is identifiable and reversible after the fact.

create table if not exists opening_balances (
  id             uuid        primary key default gen_random_uuid(),
  kind           text        not null check (kind in ('ADVANCE','UNBILLED','INVOICE')),
  -- The reference in the old books: the invoice number, trip or LR number.
  reference      text        not null check (length(trim(reference)) > 0),
  -- A client owes an open invoice or an unbilled trip; a transporter holds an
  -- advance. Exactly one is set, and which one follows from the kind.
  client_id      uuid        references clients(id),
  vendor_id      uuid        references vendors(id),
  amount_paise   bigint      not null check (amount_paise > 0),
  -- The date of the invoice, trip or advance; ageing is counted from it.
  dated          date        not null,
  status         text        not null default 'OPEN' check (status in ('OPEN','SETTLED')),
  settled_at     timestamptz,
  settled_by     uuid        references users(id),
  settled_note   text,
  batch_id       uuid        not null references import_batches(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint opening_balances_party_follows_kind check (
    (kind = 'ADVANCE' and vendor_id is not null and client_id is null) or
    (kind <> 'ADVANCE' and client_id is not null and vendor_id is null)
  ),
  constraint opening_balances_settled_matches_status check (
    (status = 'SETTLED') = (settled_at is not null)
  )
);

-- The same old invoice or advance cannot be carried in twice — a second run of
-- the same file is refused at dry run, and this holds even if two runs race.
create unique index if not exists opening_balances_kind_reference on opening_balances (kind, upper(reference));
create index if not exists opening_balances_client on opening_balances (client_id);
create index if not exists opening_balances_vendor on opening_balances (vendor_id);
create index if not exists opening_balances_status on opening_balances (status);

drop trigger if exists opening_balances_set_updated_at on opening_balances;
create trigger opening_balances_set_updated_at before update on opening_balances
  for each row execute function public.set_updated_at();

grant select, insert, update on opening_balances to internal_api;
