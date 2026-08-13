-- The check that proves the schema's security posture, not just its shape.
--
-- Run after every migration, and in the deploy pipeline:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/grants.sql
--
-- It asserts the NEGATIVE. A test that only checks the granted columns work will
-- pass on a role holding GRANT ALL, which is exactly the failure it exists to
-- catch (vendor-specs/01-P1 §1.2).

\set ON_ERROR_STOP on

do $$
declare
  bad text;
begin
  -- 1 · The redaction columns are unreadable by vendor_api ────────────────
  foreach bad in array array[
    'indents.client_id', 'indents.sell_rate', 'indents.sourcing_rate',
    'trips.client_id',   'trips.billed',
    'lorry_receipts.consignor', 'lorry_receipts.consignee', 'lorry_receipts.invoice'
  ] loop
    if has_column_privilege('vendor_api', split_part(bad,'.',1), split_part(bad,'.',2), 'SELECT') then
      raise exception 'REDACTION FAILURE: vendor_api can SELECT %  (NFR-02, BR-55, D-38)', bad;
    end if;
  end loop;

  -- 2 · The columns it does need still work ───────────────────────────────
  foreach bad in array array[
    'indents.bid_min', 'indents.bid_max', 'trips.buy_rate', 'lorry_receipts.goods'
  ] loop
    if not has_column_privilege('vendor_api', split_part(bad,'.',1), split_part(bad,'.',2), 'SELECT') then
      raise exception 'OVER-REVOKED: vendor_api cannot SELECT %, the portal will 500', bad;
    end if;
  end loop;

  -- 3 · Whole tables it must never reach ──────────────────────────────────
  foreach bad in array array[
    'clients','invoices','receipts','payments','trip_charges',
    'rfqs','rfq_lanes','rate_card_lanes','users','config'
  ] loop
    if has_table_privilege('vendor_api', bad, 'SELECT') then
      raise exception 'REDACTION FAILURE: vendor_api can SELECT the whole of %', bad;
    end if;
  end loop;

  -- 4 · Audit is append-only for both roles (NFR-03, ADR-02 §7) ───────────
  if not has_table_privilege('vendor_api', 'audit_events', 'INSERT') then
    raise exception 'vendor_api cannot INSERT audit_events — portal writes would go unaudited';
  end if;
  if has_table_privilege('vendor_api', 'audit_events', 'SELECT') then
    raise exception 'vendor_api can read audit_events';
  end if;
  if has_table_privilege('internal_api', 'audit_events', 'UPDATE')
  or has_table_privilege('internal_api', 'audit_events', 'DELETE') then
    raise exception 'audit_events is not append-only for internal_api (NFR-03)';
  end if;

  -- 5 · PostgREST is shut (part 14 §6 — grants without RLS) ───────────────
  foreach bad in array array['anon','authenticated'] loop
    if has_table_privilege(bad, 'indents', 'SELECT') then
      raise exception
        'ANON LEAK: % can SELECT indents. RLS is not in use, so a table grant here '
        'serves sell_rate over PostgREST to anyone holding the anon key', bad;
    end if;
  end loop;

  -- 6 · NFR-09 — no approximate type on a money column ────────────────────
  select string_agg(format('%s.%s is %s', table_name, column_name, data_type), ', ')
    into bad
    from information_schema.columns
   where table_schema = 'public'
     and data_type in ('numeric','double precision','real','money')
     -- The four known exceptions. A coordinate is not money; see the foot of
     -- the schema migration. Anything else appearing here is a real finding.
     and not (table_name in ('branches','telematics_pings') and column_name in ('lat','lng'));
  if bad is not null then
    raise exception 'NFR-09 FAILURE: approximate types on %', bad;
  end if;

  -- 7 · Every table carries its timestamps ────────────────────────────────
  select string_agg(t.table_name, ', ')
    into bad
    from information_schema.tables t
   where t.table_schema = 'public'
     and t.table_type   = 'BASE TABLE'
     and not exists (
       select 1 from information_schema.columns c
        where c.table_schema = t.table_schema
          and c.table_name   = t.table_name
          and c.column_name  = 'created_at');
  if bad is not null then
    raise exception 'missing created_at on: %', bad;
  end if;

  raise notice 'grants.sql: all assertions passed';
end
$$;

-- 8 · The negative grant, executed rather than inspected ──────────────────
-- has_column_privilege() reads the catalogue; this proves the planner agrees.
-- Expected: ERROR  permission denied for table indents
--
--   set role vendor_api;
--   select client_id from indents limit 1;
--   reset role;
--
-- Left commented because it aborts the transaction by design. The e2e isolation
-- suite (vendor-specs/02-redaction-contract.md §4, assertion 6a) runs it for real.
