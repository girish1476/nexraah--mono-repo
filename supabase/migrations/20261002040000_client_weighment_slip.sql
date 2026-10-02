-- Whether a client wants a weighment slip with each load.
--
-- Not every client does. Where they do not, the order's Documents tab shows
-- the weighment slip as not needed instead of leaving it open forever.
-- It never gated the advance (it is not in config.advance_document_set).
--
-- Forward-only and idempotent.

alter table clients add column if not exists needs_weighment_slip boolean not null default false;
