-- A client's billing address, state and PIN code.
--
-- The console has asked for all three when a client is added — the tax
-- invoice prints them under the client's name, and a GST invoice needs the
-- buyer's address and state — but the database had only `billing_city`. On a
-- real server the form's extra fields were refused outright, so no client
-- could be added at all; on the demo they lived only in the browser.
--
-- Optional, so the clients already on file stay valid until someone fills them in.

alter table clients
  add column if not exists billing_address text,
  add column if not exists billing_state   text,
  add column if not exists billing_pincode text
    check (billing_pincode is null or billing_pincode ~ '^[1-9][0-9]{5}$');
