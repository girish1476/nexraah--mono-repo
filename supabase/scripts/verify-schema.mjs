/**
 * Apply every migration and the seed to a real Postgres, in process.
 *
 * Why this exists: for most of this project's life no migration had ever been
 * executed. There was no local database and no Docker, so `tsc` and
 * `nest build` were the only checks the schema got — and neither runs SQL. A
 * column referenced before it exists, a foreign key to a table added later, or
 * an `ON CONFLICT` naming a constraint that has since been replaced all pass
 * every check the project has and fail on the day someone points it at
 * Supabase. The first run of this script found exactly that: `seed.sql`
 * arbitrated on `vendor_fleet(registration)` after migration 20260824140000
 * replaced that global unique with a per-vendor one, so `supabase db reset`
 * aborted.
 *
 * PGlite is Postgres compiled to WASM. It is the real planner and the real
 * DDL, so ordering and reference errors surface exactly as they would on a
 * server — with no container, no credentials and no network.
 *
 * WHAT IT CANNOT CHECK. Cluster-level objects do not exist here: `CREATE ROLE`,
 * `GRANT`, and Supabase's `auth`/`storage` schemas. Migrations that need those
 * are reported as "needs Supabase" rather than counted as failures, because
 * failing on them here says nothing about whether they work on Supabase. That
 * means **the column-level grants that keep a transporter out of client data
 * are NOT verified by this script** — `supabase/tests/grants.sql` is what
 * covers those, and it needs a real Supabase instance.
 *
 * Run it:
 *   npm install --no-save @electric-sql/pglite
 *   node supabase/scripts/verify-schema.mjs
 *
 * Deliberately not wired into package.json: it is a check you run when you
 * touch the schema, and adding a WASM Postgres to everyone's install for that
 * is a poor trade. Exit code is non-zero if anything real failed, so CI can
 * call it after installing the one package.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');
const SEED = join(HERE, '..', 'seed.sql');

/** Errors meaning "PGlite lacks a Supabase feature", not "the SQL is wrong". */
const ENVIRONMENT_LIMITS = [
  /role "?[\w-]+"? does not exist/i,
  /permission denied/i,
  /schema "(storage|auth)" does not exist/i,
  /function auth\./i,
  /unrecognized configuration parameter/i,
  /must be superuser/i,
  /is not supported/i,
];
const isEnvLimit = (m) => ENVIRONMENT_LIMITS.some((re) => re.test(m));

const db = new PGlite({ extensions: { pgcrypto } });
await db.waitReady;

/*
 * Supabase provides these and the migrations rightly assume them. `auth.users`
 * is the one that matters — `users.auth_user_id` and `vendor_users.auth_user_id`
 * are real foreign keys onto it, so without the table the first schema
 * migration fails and every later one cascades. Only the columns the
 * migrations and seed actually reference are modelled.
 */
await db.exec(`
  create schema if not exists auth;
  create schema if not exists storage;
  create extension if not exists pgcrypto;

  create table if not exists auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_app_meta_data  jsonb,
    raw_user_meta_data jsonb,
    created_at         timestamptz not null default now()
  );

  create table if not exists storage.buckets (
    id         text primary key,
    name       text not null,
    public     boolean not null default false,
    created_at timestamptz not null default now()
  );
`);

const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
console.log(`Applying ${files.length} migrations\n`);

const failures = [];
let skipped = 0;

for (const file of files) {
  try {
    await db.exec(await readFile(join(MIGRATIONS, file), 'utf8'));
    console.log(`  ok    ${file}`);
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0];
    // A migration that opened `begin;` and failed leaves the session aborted,
    // which would report every later file as broken regardless of its own SQL.
    await db.exec('rollback').catch(() => {});
    if (isEnvLimit(msg)) {
      console.log(`  skip  ${file}  (needs Supabase: ${msg.slice(0, 70)})`);
      skipped++;
    } else {
      console.log(`  FAIL  ${file}\n        ${msg}`);
      failures.push({ file, msg });
    }
  }
}

if (!failures.length) {
  try {
    await db.exec(await readFile(SEED, 'utf8'));
    console.log('\n  ok    seed.sql');
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0];
    await db.exec('rollback').catch(() => {});
    if (isEnvLimit(msg)) console.log(`\n  skip  seed.sql (needs Supabase: ${msg.slice(0, 70)})`);
    else {
      console.log(`\n  FAIL  seed.sql\n        ${msg}`);
      failures.push({ file: 'seed.sql', msg });
    }
  }
}

const tables = await db.query(
  `select table_name from information_schema.tables
   where table_schema = 'public' order by table_name`,
);

console.log('\n──────── result ────────');
console.log(`applied cleanly : ${files.length - failures.length - skipped}/${files.length}`);
console.log(`needs Supabase  : ${skipped}`);
console.log(`REAL FAILURES   : ${failures.length}`);
console.log(`tables created  : ${tables.rows.length}`);

if (failures.length) {
  console.log('\nThese would fail on Supabase too:');
  for (const f of failures) console.log(`  ${f.file}\n    ${f.msg}`);
}

process.exit(failures.length ? 1 : 0);
