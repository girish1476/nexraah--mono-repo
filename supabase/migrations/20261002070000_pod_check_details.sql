-- The details typed in when a proof of delivery is checked.
--
-- A POD is now checked like every other document: the scan beside the details
-- read off it (who received it, the quantity received), plus what the check
-- found — shortages, damages, charges, a corrected delivery date. The findings
-- land where they always have (SDRs, trip charges, the trip's delivery date);
-- the details themselves are kept on the receipt, once for the proof and once
-- for the hard copy checked after an E-POD.
--
-- Forward-only and idempotent.

alter table pod_receipts add column if not exists details           jsonb;
alter table pod_receipts add column if not exists hard_copy_details jsonb;
