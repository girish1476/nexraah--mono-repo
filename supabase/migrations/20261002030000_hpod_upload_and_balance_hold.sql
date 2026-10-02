-- H-POD is an upload, and an E-POD alone does not release the balance.
--
-- 1. H-POD: the signed hard copy is scanned and uploaded, like an E-POD. Its
--    courier docket is optional now (BR-51's check still holds: docket and
--    sent-on are both present or both absent).
-- 2. E-POD: the soft copy still stops the clock and can be verified and
--    approved, so the delivery is closed. But the transporter's balance stays
--    held until the hard copy behind it is uploaded and verified. These
--    columns hold that upload and that check on the receipt the E-POD made.
--
-- Forward-only and idempotent.

alter table pod_receipts add column if not exists hard_copy_attachment_ids uuid[]      not null default '{}';
alter table pod_receipts add column if not exists hard_copy_verified_at    timestamptz;
alter table pod_receipts add column if not exists hard_copy_verified_by    uuid references users(id);
