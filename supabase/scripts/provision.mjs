#!/usr/bin/env node
/**
 * provision.mjs — the steps a hosted Supabase project needs AFTER
 * `supabase db push`, none of which belong in a migration:
 *
 *   1. passwords for the two database logins the migrations create
 *      (`internal_api`, `vendor_api`) — part 14 §4
 *   2. the private `nexraah` storage bucket — part 14 §7
 *   3. real staff sign-ins: one Supabase Auth account per person, linked
 *      to a `users` row by `auth_user_id` — part 14 §4.1 (the seed does
 *      the same for fixtures; this does it for people)
 *   4. a check that the grants the whole design rests on actually held
 *
 * Usage (from the repo root, with `pg` resolved from apps/internal-api):
 *
 *   node supabase/scripts/provision.mjs \
 *     --db-url "postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
 *     --staff supabase/scripts/staff.json
 *
 * Env: INTERNAL_API_DB_PASSWORD, VENDOR_API_DB_PASSWORD (step 1; skipped
 * with a warning if absent). Never pass the service-role key to anything.
 *
 * Idempotent: safe to re-run. Existing accounts are left alone (password
 * unchanged); new ones are created. Nothing here deletes.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const require = createRequire(new URL('../../apps/internal-api/package.json', import.meta.url));
const { Client } = require('pg');

// ---- args --------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DB_URL = opt('--db-url') ?? process.env.SUPABASE_DB_URL;
const STAFF_FILE = opt('--staff');
const DRY = args.includes('--dry-run');
if (!DB_URL) {
  console.error('provision: --db-url (or SUPABASE_DB_URL) is required — the session-pooler URL as the postgres user.');
  process.exit(2);
}

const ROLE_CODES = new Set(['OPS', 'COMPLIANCE', 'FINANCE', 'BD', 'LEADERSHIP', 'ADMIN']);
const BUCKET = process.env.STORAGE_BUCKET ?? 'nexraah';
const MIME = ['image/jpeg', 'image/png', 'application/pdf'];

function lit(s) {
  // pg's Client#escapeLiteral for DDL, which cannot take bind parameters.
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("set search_path to public, extensions");
  const out = { rolesPasswordSet: [], bucket: null, staff: [], checks: {} };

  // ---- 0. sanity: were the migrations applied? ---------------------------
  const tables = (await client.query(
    "select table_name from information_schema.tables where table_schema='public' and table_name in ('roles','permissions','users','vendors','clients','indents','trips','orders','audit_events')",
  )).rows.map((r) => r.table_name);
  const missing = ['roles', 'permissions', 'users', 'vendors', 'clients', 'indents', 'trips', 'orders'].filter((t) => !tables.includes(t));
  if (missing.length) {
    throw new Error(`migrations not applied — missing tables: ${missing.join(', ')}. Run \`supabase db push --db-url ...\` first.`);
  }
  const roles = (await client.query('select code from roles order by code')).rows.map((r) => r.code);
  const permCount = (await client.query('select count(*)::int as n from permissions')).rows[0].n;
  console.log(`✓ schema present · roles: ${roles.join(', ')} · permissions: ${permCount}`);

  // ---- 1. database login passwords ---------------------------------------
  for (const [role, envKey] of [['internal_api', 'INTERNAL_API_DB_PASSWORD'], ['vendor_api', 'VENDOR_API_DB_PASSWORD']]) {
    const pw = process.env[envKey];
    const exists = (await client.query('select 1 from pg_roles where rolname=$1', [role])).rowCount === 1;
    if (!exists) throw new Error(`role ${role} does not exist — the roles migration did not run`);
    if (!pw) {
      console.warn(`! ${envKey} not set — leaving ${role} password unchanged`);
      continue;
    }
    if (!DRY) await client.query(`alter role ${role} with login password ${lit(pw)}`);
    out.rolesPasswordSet.push(role);
    console.log(`✓ password set for ${role}`);
  }

  // ---- 2. storage bucket ---------------------------------------------------
  const hasStorage = (await client.query("select to_regclass('storage.buckets') as t")).rows[0].t;
  if (!hasStorage) {
    console.warn('! storage.buckets not found — create the private bucket in the dashboard instead');
  } else if (!DRY) {
    await client.query(
      `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
       values ($1, $1, false, 10485760, $2)
       on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = $2`,
      [BUCKET, MIME],
    );
    out.bucket = BUCKET;
    console.log(`✓ bucket "${BUCKET}" private, 10 MB, ${MIME.join('/')}`);
  }

  // ---- 3. staff sign-ins ---------------------------------------------------
  if (STAFF_FILE) {
    const staff = JSON.parse(readFileSync(STAFF_FILE, 'utf8'));
    if (!Array.isArray(staff)) throw new Error('--staff must be a JSON array');
    const hasProviderId = (await client.query(
      "select 1 from information_schema.columns where table_schema='auth' and table_name='identities' and column_name='provider_id'",
    )).rowCount === 1;

    for (const s of staff) {
      const email = String(s.email ?? '').trim().toLowerCase();
      const role = String(s.role ?? '').toUpperCase();
      if (!email || !s.name || !ROLE_CODES.has(role)) {
        throw new Error(`staff entry needs name, email and role in ${[...ROLE_CODES].join('|')}: ${JSON.stringify(s)}`);
      }
      const roleRow = (await client.query('select id from roles where code=$1', [role])).rows[0];
      if (!roleRow) throw new Error(`role ${role} is not seeded in this database`);
      let branchId = null;
      if (s.branch) {
        const b = (await client.query('select id from branches where code=$1', [String(s.branch).toUpperCase()])).rows[0];
        if (!b) throw new Error(`branch ${s.branch} does not exist yet — create it in Settings → Branches first, or drop "branch" for ${email}`);
        branchId = b.id;
      }
      if (DRY) { out.staff.push({ email, role, status: 'dry-run' }); continue; }

      await client.query('begin');
      try {
        // users row — the internal identity; upsert by email.
        const u = (await client.query(
          `insert into users (name, email, phone, role_id, branch_id, status)
           values ($1, $2, $3, $4, $5, 'ACTIVE')
           on conflict (email) do update set name = excluded.name, role_id = excluded.role_id, branch_id = excluded.branch_id, status = 'ACTIVE'
           returning id, auth_user_id`,
          [s.name, email, s.phone ?? null, roleRow.id, branchId],
        )).rows[0];

        // auth account — reuse if one already exists for that email.
        let authId = (await client.query('select id from auth.users where lower(email)=$1', [email])).rows[0]?.id ?? null;
        let created = false;
        let password = null;
        if (!authId) {
          password = s.password ?? randomBytes(9).toString('base64url');
          authId = (await client.query('select gen_random_uuid() as id')).rows[0].id;
          await client.query(
            `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
               email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
               confirmation_token, recovery_token, email_change, email_change_token_new)
             values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
               crypt($3, gen_salt('bf')), now(), now(), now(),
               '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', $4::text), '', '', '', '')`,
            [authId, email, password, s.name],
          );
          if (hasProviderId) {
            await client.query(
              `insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
               values (gen_random_uuid(), $1, $1::text, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now())`,
              [authId, email],
            );
          } else {
            await client.query(
              `insert into auth.identities (id, user_id, identity_data, provider, created_at, updated_at)
               values (gen_random_uuid(), $1, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now())`,
              [authId, email],
            );
          }
          created = true;
        }
        await client.query('update users set auth_user_id=$1 where id=$2', [authId, u.id]);
        await client.query('commit');
        out.staff.push({ email, role, status: created ? 'created' : 'linked-existing', password });
        console.log(`✓ ${role.padEnd(10)} ${email}${created ? '  (new sign-in)' : '  (linked existing sign-in)'}`);
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    }
  }

  // ---- 4. verify the grants that make the design hold ----------------------
  const q = async (sql) => (await client.query(sql)).rows[0].ok;
  out.checks.anonCannotReadVendors = !(await q("select has_table_privilege('anon','public.vendors','select') as ok"));
  out.checks.authenticatedCannotReadIndents = !(await q("select has_table_privilege('authenticated','public.indents','select') as ok"));
  out.checks.internalApiReadsVendors = await q("select has_table_privilege('internal_api','public.vendors','select') as ok");
  out.checks.vendorApiBlindToClientId = !(await q("select has_column_privilege('vendor_api','public.indents','client_id','select') as ok"));
  for (const [k, v] of Object.entries(out.checks)) console.log(`${v ? '✓' : '✗'} ${k}`);
  const bad = Object.entries(out.checks).filter(([, v]) => !v).map(([k]) => k);

  await client.end();

  const newPw = out.staff.filter((s) => s.password);
  if (newPw.length) {
    console.log('\nTemporary passwords (share privately, ask each person to change it after first sign-in):');
    for (const s of newPw) console.log(`  ${s.email}  ${s.password}`);
  }
  if (bad.length) {
    console.error(`\n✗ grant checks failed: ${bad.join(', ')} — do not point a portal at this database until fixed.`);
    process.exit(1);
  }
  console.log(DRY ? '\n(dry run — nothing written)' : '\nDone.');
}

main().catch((e) => {
  console.error('provision failed:', e.message);
  process.exit(1);
});
