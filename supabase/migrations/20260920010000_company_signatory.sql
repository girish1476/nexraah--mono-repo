-- The printed invoice's signature line ("For Nexraah Logistics Private
-- Limited · authorised signatory") was hard-coded text — the company name
-- half was already editable via `config.company.name`, but "authorised
-- signatory" had no field behind it at all, so there was no way for an
-- administrator to put a real person's name and title there once a specific
-- signatory was designated.
--
-- Same pattern as `20260920000000_company_sac_code.sql`: merge the new key
-- into the existing seeded row without disturbing anything else in it, and
-- guard so this is safe whether the seed row exists from a fresh provision
-- or an already-provisioned database.
update config
set value = value || '{"signatory": "Authorised Signatory"}'::jsonb,
    updated_at = now()
where key = 'company'
  and not (value ? 'signatory');
