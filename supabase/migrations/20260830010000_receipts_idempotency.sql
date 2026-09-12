-- Receipts idempotency — mirrors payments.idempotency_key (00-conventions §8).
--
-- POST /receipts had no dedup protection, unlike the payments advance/balance
-- release routes: a double-submitted partial receipt (smaller than the
-- remaining balance) could be recorded twice with no unique-constraint to
-- stop it, double-crediting invoices.received. `payments.idempotency_key`
-- was baked into the original schema (20260814090100_c1_schema.sql) with no
-- prior rows to backfill; `receipts` already has rows in every environment,
-- so this adds the column nullable, backfills each existing row with its own
-- generated key (a receipt already recorded is its own past event, never a
-- replay of anything), then locks it down not-null + unique exactly like
-- payments'.

alter table receipts add column idempotency_key text;

update receipts set idempotency_key = gen_random_uuid()::text where idempotency_key is null;

alter table receipts alter column idempotency_key set not null;

alter table receipts add constraint receipts_idempotency_key_key unique (idempotency_key);
