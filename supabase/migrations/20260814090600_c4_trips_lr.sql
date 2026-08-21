-- C4 · trips & lorry receipt — correct `trip.document_kinds`
--
-- 090300 seeded `trip.document_kinds` as ["LR","EWAY_BILL","LOADING_SLIP",
-- "WEIGHMENT_SLIP","INVOICE","RC","DRIVING_LICENCE","INSURANCE","PERMIT",
-- "FITNESS","POD"] — invented, and inconsistent with the eight of BR-58
-- (part 01 §4.2, 00-conventions.md's `advance_document_set` example, both
-- naming `CLIENT_INVOICE_OR_PO` and `PUC`, neither naming `LOADING_SLIP` or
-- `WEIGHMENT_SLIP`). docs/api/04-trips-lr.md's own document group table
-- lists exactly ten kinds across five groups (CLIENT_INVOICE_OR_PO, EWAY_BILL
-- | RC, INSURANCE, FITNESS, PERMIT, PUC | DRIVING_LICENCE | LR | POD) — the
-- prose above that table says "eleven", but the table itself, cross-checked
-- against `internal-spec/05-C4`'s identical table, only ever lists ten; ten
-- is treated as correct here rather than inventing an eleventh kind to match
-- a number that appears nowhere else.
--
-- `trip_documents.kind` has no CHECK constraint (090100: "meant to change
-- without a migration"), so this is purely a config correction — nothing to
-- ALTER on the table itself. `gatesAdvance` (docs/api/04 §Documents) is
-- computed by checking membership in `config.advance_document_set`, so the
-- two lists must share the exact same strings for the eight that overlap, or
-- that computation silently returns false for all of them.

update config
   set value = '[
     "CLIENT_INVOICE_OR_PO","EWAY_BILL","RC","INSURANCE","FITNESS","PERMIT",
     "PUC","DRIVING_LICENCE","LR","POD"
   ]'::jsonb,
       updated_at = now()
 where key = 'trip.document_kinds';

-- BR-32/BR-44: `GET /trips/:id/cross-check` returns `overridden` and
-- `POST /trips/:id/lr/generate` must stop blocking once a DOC_OVERRIDE
-- approval clears — nothing in part 02's schema holds that state.
alter table trips add column cross_check_overridden boolean not null default false;
