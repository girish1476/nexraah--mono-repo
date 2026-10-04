-- invoices.sac_code and invoices.details — set from the invoice's edit screen.
--
-- 1. sac_code: the printed SAC was always `config.company.sac` (996511, a
--    full-truck-load road transport service). A load that is not FTL carries
--    a different code, so an invoice can now hold its own. Null means "the
--    company's code", which is what every existing invoice keeps printing.
-- 2. details: one free line for anything the invoice missed — a PO number, a
--    reference the client asked for. Printed on the invoice when present.
--
-- Forward-only and idempotent.

alter table invoices add column if not exists sac_code text;
alter table invoices add column if not exists details  text;
