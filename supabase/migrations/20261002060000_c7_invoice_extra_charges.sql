-- C7 · invoices.extra_charges — named charge lines beyond the fixed heads
--
-- The invoice form's "+ Add charge" lets finance bill something the four
-- fixed heads (loading, unloading, detention, other) don't name — each line
-- is `{ "label": text, "amountPaise": integer >= 0 }`. They add to the total
-- the same way the fixed heads do; the service validates the shape.
--
-- `discount` stays on the table: the form no longer offers it, but invoices
-- already issued with one keep their figure and still print it.

alter table invoices add column extra_charges jsonb not null default '[]'::jsonb;
