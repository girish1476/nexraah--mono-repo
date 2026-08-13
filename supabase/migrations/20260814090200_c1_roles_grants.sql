-- C1 · roles and grants — ADR-02 §3, part 02 §7, vendor-specs/01-P1 §1.2
--
-- Written in the same wave as the tables. A grant added later is a grant that
-- gets forgotten.
--
-- Both roles are held by internal-api, on two pools. `portalPool` connects as
-- vendor_api and serves /api/v1/portal/*; `internalPool` connects as internal_api
-- and serves everything else. vendor-api holds no credential at all.

-- ─────────────────────────────────────────────────────────────
-- 0 · Close the PostgREST door first
-- ─────────────────────────────────────────────────────────────
--
-- Supabase grants `anon` and `authenticated` on tables in `public` by default and
-- expects RLS to be the control. Part 14 §6 records that we do not use RLS: no
-- process here connects as `authenticated`, so auth.uid() would be null in every
-- policy we could write.
--
-- Grants without RLS means PostgREST would serve `indents` — including sell_rate
-- and client_id — to anyone holding the anon key, which ships in the browser
-- bundle. The column grants below would be bypassed entirely, on a port nobody
-- is watching. This block is not optional.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke usage on schema public            from anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- `service_role` is left as Supabase configures it. Nothing in this system holds
-- that key — part 14 §4. Its absence from every .env is asserted in CI, because a
-- process holding it bypasses everything below without failing a single test.

-- ─────────────────────────────────────────────────────────────
-- 1 · internal_api — the console
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'internal_api') then
    create role internal_api login;
  end if;
end $$;

grant usage on schema public to internal_api;
grant select, insert, update, delete on all tables    in schema public to internal_api;
grant usage, select                  on all sequences in schema public to internal_api;

-- `on all tables` covers what exists today only. Without this, every table a
-- later migration adds is invisible to the console until someone notices.
alter default privileges in schema public
  grant select, insert, update, delete on tables    to internal_api;
alter default privileges in schema public
  grant usage, select                  on sequences to internal_api;

-- NFR-03: the audit trail is append-only. The triggers on audit_events raise on
-- UPDATE and DELETE; this makes the same statement at the privilege layer, so a
-- future `alter table ... disable trigger` is not enough to rewrite history.
revoke update, delete on audit_events from internal_api;

-- ─────────────────────────────────────────────────────────────
-- 2 · vendor_api — the transporter surface
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'vendor_api') then
    create role vendor_api login;
  end if;
end $$;

grant usage on schema public to vendor_api;

-- Full access to what is theirs
grant select, insert, update on vendor_fleet, vendor_kyc, vendor_documents to vendor_api;
grant select, insert         on pod_receipts, vendor_bills                 to vendor_api;
grant select, insert         on attachments                                to vendor_api;
grant select                 on vendors, vendor_users                      to vendor_api;

-- Quotes: insert to submit, and UPDATE(status) to withdraw.
--
-- vendor-specs/01-P1 §1.2 grants only SELECT and INSERT here, but
-- `DELETE /portal/quotes/:id` is a withdrawal — it moves status to WITHDRAWN
-- rather than deleting the row, and it cannot work without an UPDATE grant.
-- Scoped to the one column so a withdrawal cannot become a price edit after the
-- band check has already passed.
grant select, insert  on quotes         to vendor_api;
grant update (status) on quotes         to vendor_api;

-- ADR-02 §7 / part 02 §7: portal writes now happen in a process that can audit
-- them. NFR-03 was previously blind to every transporter action. Append only —
-- a transporter's request may add to the log and may never read or alter it.
grant insert on audit_events to vendor_api;

-- Column-scoped on everything else. The absent columns are the point.
grant select (id, code, from_city, to_city, material, weight_kg, truck_type,
              pickup_date, transit_days, reporting_rule, branch_id,
              bid_min, bid_max, advance_pct, remarks, stage, vendor_id)
  on indents to vendor_api;
-- NOT GRANTED on indents: client_id, sell_rate, sourcing_rate, buy_rate,
--                         rate_card_lane_id, spot_confirmation_attachment_id,
--                         awarded_quote_id, band_locked, failure_cause

grant select (id, code, indent_id, vendor_id, vehicle_no, vehicle_type, capacity_kg,
              driver_name, driver_licence, lane, weight_kg, transit_days_required,
              actual_transit_days, remarks, buy_rate, eway_no, eway_valid_till,
              stage, delivered_at, pod_status, pod_received_at, pod_penalty,
              advance_paid, balance_paid)
  on trips to vendor_api;
-- NOT GRANTED on trips: client_id, billed, branch_id, pod_closure_basis
-- buy_rate IS granted: it is their freight, the rate they quoted and won.

grant select (id, code, trip_id, lr_date, booked_at, branch_id, goods, eway,
              vehicle, driver, transit_days, remarks, status, shared_at)
  on lorry_receipts to vendor_api;
-- NOT GRANTED on lorry_receipts: consignor, consignee, invoice, charges.
-- The printed document names both parties — it must, legally. The portal does
-- not, because the portal is a searchable record and the paper is not.

-- Everything else is unreachable.
revoke all on clients, invoices, invoice_trips, receipts, rfqs, rfq_lanes,
              rfq_lane_sourcing, rate_card_lanes, trip_charges, payments,
              config, number_series, users, roles, permissions, role_permissions,
              branches, approvals, leads, issues, market_gap_targets,
              trip_documents, vendor_advance_history, telematics_pings,
              telematics_alerts, notifications
  from vendor_api;

-- Re-assert after the blanket revoke above: `revoke all on audit_events` is not
-- in that list, but a future edit that adds it must not silently kill auditing.
grant insert on audit_events to vendor_api;

-- Future tables default to unreachable for vendor_api. A table added next quarter
-- is invisible to the portal until someone deliberately grants it — the same
-- argument as @Expose() over @Exclude(), one layer down.
alter default privileges in schema public revoke all on tables from vendor_api;
