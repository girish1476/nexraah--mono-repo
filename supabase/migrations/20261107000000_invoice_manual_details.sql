-- A manual invoice — filled in by an administrator rather than raised from
-- trips — keeps what it says beyond the charge heads here: bill-to, place of
-- supply, consignor and consignee, truck, route, goods, gross weight, who pays
-- the GST under reverse charge, and its lines (CGST Rules 46 and 54(3)).
-- Null on every other invoice. Its lines' total is stored in `freight`, so
-- totals, receivables and receipts treat it like any invoice.
alter table invoices add column if not exists manual jsonb;
