-- C2 · correction — a rejected vendor document/KYC item never told the
-- transporter why
--
-- Every comparable table already carries this column — trip_documents
-- (20260814090100_c1_schema.sql), pod_receipts (same file), client_documents
-- (20260825040000_client_onboarding.sql) — vendor_kyc and vendor_documents
-- were the only two left out. The console's reject action already collects a
-- reason (`vendors.controller.ts`'s verify routes, `VerifyItemDto.reason`)
-- and has always written it to the audit log only, never onto the row — so
-- the vendor-portal profile screen, built around displaying this reason, had
-- nothing to read and fell back to a blank. Same rejection loop as an
-- undocumented require: the transporter re-uploads the identical paper and
-- it is rejected again.

alter table vendor_kyc
  add column reject_reason text;

alter table vendor_documents
  add column reject_reason text;
