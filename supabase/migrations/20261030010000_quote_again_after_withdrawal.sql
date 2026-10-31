-- A transporter who withdraws a quote can quote again on the same load.
--
-- `quotes` was `unique (indent_id, vendor_id)` whatever the status, so a
-- withdrawn quote kept the pair and the next attempt was `409 QUOTE_EXISTS` —
-- from the portal and from the console alike. The rule the schema's own
-- comment states is "one live quote per vendor per load"; this makes the
-- constraint say that. The withdrawn row stays, as history.
--
-- A partial unique index rather than an `update (amount, band_position)` grant
-- for `vendor_api`: a new quote is a new row through the same band check, so a
-- withdrawal still cannot turn into a price edit after the check has passed.

alter table quotes drop constraint if exists quotes_indent_id_vendor_id_key;

create unique index if not exists quotes_one_live_per_vendor
  on quotes (indent_id, vendor_id)
  where status <> 'WITHDRAWN';
