-- The printed invoice is missing its SAC (Services Accounting Code) — a
-- required field on a GST tax invoice for a goods transport agency, and the
-- one the owner's reference invoice carries (996511, "Road transport of
-- goods"). `config.company` is the seeded source for every other company
-- fact the invoice prints (name, GSTIN, PAN, CIN, address, bank) — see
-- 20260814090400's seed row — so the code belongs there too, not as a new
-- config key.
--
-- `value || jsonb` merges in the key without disturbing anything already
-- there, and the `not (value ? 'sac')` guard makes this safe to run whether
-- the seed row exists from a fresh provision or an existing one — the
-- `20260814090400` seed itself is `on conflict (key) do nothing`, so an
-- already-provisioned database never picks up a value added to that file
-- after the fact.
update config
set value = value || '{"sac": "996511"}'::jsonb,
    updated_at = now()
where key = 'company'
  and not (value ? 'sac');
