-- The hard copy behind an E-POD.
--
-- Operations take the soft copy of the proof of delivery first (E-POD) and
-- follow up until the signed hard copy reaches head office. The courier slip
-- of that hard copy is uploaded in the system. These columns record that
-- follow-up on the receipt the E-POD created, without changing the proof's
-- status: the soft copy already stopped the clock and can be verified.
--
-- An H-POD (hard copy logged first) can carry its courier slip too.
--
-- Forward-only and idempotent.

alter table pod_receipts add column if not exists hard_copy_docket           text;
alter table pod_receipts add column if not exists hard_copy_sent_on          date;
alter table pod_receipts add column if not exists hard_copy_received_on      date;
alter table pod_receipts add column if not exists courier_slip_attachment_id uuid;
