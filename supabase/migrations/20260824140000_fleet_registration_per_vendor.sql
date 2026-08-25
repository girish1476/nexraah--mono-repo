-- `vendor_fleet.registration` must be unique WITHIN a vendor, not globally.
--
-- The original schema (20260814090100_c1_schema.sql:229) declared it
-- `text not null unique`. That is a privacy leak, not a style preference:
-- when a transporter adds a plate that a DIFFERENT transporter already has on
-- file, a global constraint means the only truthful answers are "this vehicle
-- already exists" — which discloses that another of our vendors runs that
-- truck — or a lie. Both are wrong. `docs/specs/vendor-specs/04-P3` §1 calls
-- for within-vendor uniqueness for exactly this reason.
--
-- Two vendors legitimately holding the same registration is also a real
-- situation, not a data error: a vehicle changes hands, or is leased between
-- operators, and both records are correct for their own period.
--
-- Until this migration, `POST /portal/fleet` could not answer the case
-- honestly — it had to swallow the global-index violation as a generic
-- failure rather than the specific `VEHICLE_DUPLICATE` the contract defines,
-- because the specific answer would have been the disclosure.

alter table vendor_fleet
  drop constraint if exists vendor_fleet_registration_key;

create unique index if not exists vendor_fleet_vendor_registration_idx
  on vendor_fleet (vendor_id, registration);

comment on index vendor_fleet_vendor_registration_idx is
  'Within-vendor uniqueness. Deliberately NOT global: a global constraint discloses another vendor''s fleet through the duplicate error (NFR-02).';
