#!/usr/bin/env node
/**
 * check-grants.mjs — the database's security checks, in one command, after migrating:
 *
 *   1. supabase/tests/grants.sql — the transporter login cannot read client data,
 *      no money column is a fraction type, every table has its timestamps;
 *   2. does the database grant each built-in role exactly what the API's role
 *      table says (apps/internal-api/src/modules/roles/roles.constants.ts)?
 *
 * The role table exists three times: the console's permissions.ts, the API's
 * roles.constants.ts (those two are held equal by permissions-drift.test.ts),
 * and the `role_permissions` rows the API checks every request against. The
 * third drifted unnoticed — an administrator without `indent.view` — because
 * only a running database can show it. Run after migrating:
 *
 *   node supabase/scripts/check-grants.mjs --db-url "postgresql://…"
 *
 * Exits 1 on any difference. Custom roles (added from Access control) are not
 * in the table and are not checked.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const i = args.indexOf('--db-url');
const DB_URL = i >= 0 ? args[i + 1] : process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error('check-grants: --db-url (or SUPABASE_DB_URL) is required.');
  process.exit(2);
}
const constants = new URL('../../apps/internal-api/src/modules/roles/roles.constants.ts', import.meta.url);
const { SEED_GRANTS } = await import(pathToFileURL(constants.pathname.replace(/^\/([A-Za-z]:)/, '$1')).href);
const require = createRequire(new URL('../../apps/internal-api/package.json', import.meta.url));
const { Client } = require('pg');
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
const client = new Client({ connectionString: DB_URL, ...(local ? {} : { ssl: { rejectUnauthorized: false } }) });
await client.connect();

// 1 · grants.sql, as psql would run it (its one psql-only line dropped).
const grantsSql = readFileSync(new URL('../tests/grants.sql', import.meta.url), 'utf8').replace(/^\\.*$/gm, '');
try {
  await client.query(grantsSql);
  console.log('✓ grants.sql: all assertions passed');
} catch (e) {
  console.error(`✗ grants.sql: ${e.message}`);
  await client.end();
  process.exit(1);
}

// 2 · each built-in role's permissions.
const rows = (
  await client.query(
    'select r.code as role, p.code as perm from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id',
  )
).rows;
await client.end();

let bad = 0;
for (const [role, perms] of Object.entries(SEED_GRANTS)) {
  const db = rows.filter((r) => r.role === role).map((r) => r.perm);
  const missing = perms.filter((p) => !db.includes(p));
  const extra = db.filter((p) => !perms.includes(p));
  if (missing.length || extra.length) {
    bad++;
    console.error(`✗ ${role}: missing in the database: ${missing.join(', ') || '-'} · in the database only: ${extra.join(', ') || '-'}`);
  } else console.log(`✓ ${role}`);
}
process.exit(bad ? 1 : 0);
