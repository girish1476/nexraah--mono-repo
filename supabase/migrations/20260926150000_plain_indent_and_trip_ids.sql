-- Indent ids and trip ids are plain numbers, and there is no separate order id.
--
-- The owner's rule (2026-09-26): an indent id and a trip id are enough, so
-- neither carries a letter prefix ("IND-4471" is "4471", "TRP-120881" is
-- "120881"), and an order is not something a person is given a number for.
--
-- 1. The INDENT and TRIP number series stop issuing a prefix.
-- 2. Existing indents and trips are renamed to match, so old and new records
--    read the same and search treats them alike. Nothing references a code by
--    value: every foreign key is on the uuid, and the codes only ever appear in
--    free text (audit and approval descriptions), which is left as written.
-- 3. `orders.order_no` stays as a column, because the ten-step spine keys on the
--    order row, but it now simply carries the indent's own id. No ORD- number
--    is issued or shown any more.
--
-- Forward-only and idempotent: every statement is a no-op once applied.

update number_series set prefix = '' where key in ('INDENT', 'TRIP') and prefix <> '';

update indents set code = regexp_replace(code, '^IND-', '') where code like 'IND-%';
update trips   set code = regexp_replace(code, '^TRP-', '') where code like 'TRP-%';

update orders o
   set order_no = i.code
  from indents i
 where i.id = o.indent_id
   and o.order_no is distinct from i.code;
