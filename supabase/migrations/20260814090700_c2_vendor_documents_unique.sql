-- C2 · vendor_documents needs the same (vendor_id, kind) uniqueness vendor_kyc
-- already has.
--
-- `vendors.repository.ts`'s `upsertDocument()` does `INSERT ... ON CONFLICT
-- (vendor_id, kind) DO UPDATE` — one row per document kind per vendor,
-- re-submission overwrites rather than duplicates, exactly like
-- `vendor_kyc_kind_key` (090100 §2). 090100 declared that constraint on
-- `vendor_kyc` but not its sibling table; every document submission raises
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" until this exists. Caught by running the real onboarding
-- flow end-to-end against a live database.

alter table vendor_documents add constraint vendor_documents_vendor_kind_key unique (vendor_id, kind);
