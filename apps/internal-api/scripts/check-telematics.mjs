// Runnable check for the telematics alert rules and HMAC signature helper —
// the two pieces of `POST /telematics/ping` that are pure logic, no DB.
// `node scripts/check-telematics.mjs` from apps/internal-api. No test
// framework: typescript is already a devDependency, mirrors apps/
// vendor-portal/scripts/check-pod-clock.mjs's approach.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import ts from 'typescript';

const compile = (path) =>
  ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 },
  }).outputText;

async function loadModule(path) {
  const source = compile(path).replace(/^import[^\n]*\n/gm, ''); // only type-only imports
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

// alert-rules.ts has no runtime imports (its one import is a type, erased on
// compile) so it loads standalone cleanly. telematics-hmac.guard.ts is a
// real NestJS provider (decorators, DI, DomainException, the Kysely DB
// token) and can't be isolated the same way — its signature-comparison
// helper is copied verbatim here instead of imported. Source of truth stays
// src/common/guards/telematics-hmac.guard.ts; keep the two in sync.
const { deriveAlerts } = await loadModule('src/modules/telematics/alert-rules.ts');

function constantTimeHexEqual(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

const THRESHOLDS = { overspeedKmph: 80, haltMinutes: 90, darkVehicleIntervalMinutes: 120, ewayWarningWindowHours: 12 };
const NOW = Date.parse('2026-08-16T12:00:00Z');
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();

// ---- clean state: no alerts ----
assert.deepEqual(
  deriveAlerts({
    now: NOW,
    latestPing: { at: iso(1), speedKmph: 60 },
    pingsInHaltWindow: [{ at: iso(1), speedKmph: 60 }],
    ewayValidTill: null,
    thresholds: THRESHOLDS,
  }),
  [],
  'a normal recent ping under every threshold raises nothing',
);

// ---- OVERSPEED ----
assert.deepEqual(
  deriveAlerts({
    now: NOW,
    latestPing: { at: iso(1), speedKmph: 95 },
    pingsInHaltWindow: [{ at: iso(1), speedKmph: 95 }],
    ewayValidTill: null,
    thresholds: THRESHOLDS,
  }),
  ['OVERSPEED'],
  '95 > 80 kmph threshold',
);
assert.deepEqual(
  deriveAlerts({
    now: NOW,
    latestPing: { at: iso(1), speedKmph: 80 },
    pingsInHaltWindow: [{ at: iso(1), speedKmph: 80 }],
    ewayValidTill: null,
    thresholds: THRESHOLDS,
  }),
  [],
  'exactly at the threshold does not alert (strictly greater-than)',
);

// ---- LONG_HALT — needs the *entire* halt window covered by stationary pings ----
const stationaryFullWindow = Array.from({ length: 10 }, (_, i) => ({
  at: iso(i * 10), // 0,10,...,90 minutes ago — spans the full 90-minute window
  speedKmph: 0,
}));
assert.deepEqual(
  deriveAlerts({
    now: NOW,
    latestPing: { at: iso(0), speedKmph: 0 },
    pingsInHaltWindow: stationaryFullWindow,
    ewayValidTill: null,
    thresholds: THRESHOLDS,
  }),
  ['LONG_HALT'],
  'stationary (<=2kmph) for the entire 90-minute window',
);
assert.deepEqual(
  deriveAlerts({
    now: NOW,
    latestPing: { at: iso(0), speedKmph: 0 },
    pingsInHaltWindow: [{ at: iso(5), speedKmph: 0 }], // only 5 minutes of history, not the full window
    ewayValidTill: null,
    thresholds: THRESHOLDS,
  }),
  [],
  'a couple of recent slow pings (e.g. a signal) is NOT a long halt — window not fully covered',
);

// ---- DARK_VEHICLE — no ping inside the dark-vehicle interval; suppresses OVERSPEED/LONG_HALT ----
assert.deepEqual(
  deriveAlerts({
    now: NOW,
    latestPing: { at: iso(200), speedKmph: 95 }, // last seen 200 min ago, was speeding at the time
    pingsInHaltWindow: [],
    ewayValidTill: null,
    thresholds: THRESHOLDS,
  }),
  ['DARK_VEHICLE'],
  'no signal for 200 min > 120 min threshold — and a 200-minute-old speed reading is not "currently overspeeding"',
);
assert.deepEqual(
  deriveAlerts({
    now: NOW,
    latestPing: undefined,
    pingsInHaltWindow: [],
    ewayValidTill: null,
    thresholds: THRESHOLDS,
  }),
  ['DARK_VEHICLE'],
  'never pinged at all is also dark, not a crash',
);

// ---- EWAY_EXPIRING / EWAY_EXPIRED ----
assert.deepEqual(
  deriveAlerts({
    now: NOW,
    latestPing: { at: iso(1), speedKmph: 50 },
    pingsInHaltWindow: [{ at: iso(1), speedKmph: 50 }],
    ewayValidTill: new Date(NOW + 6 * 3_600_000).toISOString(), // 6h out, inside the 12h window
    thresholds: THRESHOLDS,
  }),
  ['EWAY_EXPIRING'],
  '6 hours remaining, inside the 12-hour warning window',
);
assert.deepEqual(
  deriveAlerts({
    now: NOW,
    latestPing: { at: iso(1), speedKmph: 50 },
    pingsInHaltWindow: [{ at: iso(1), speedKmph: 50 }],
    ewayValidTill: new Date(NOW - 3_600_000).toISOString(), // 1h in the past
    thresholds: THRESHOLDS,
  }),
  ['EWAY_EXPIRED'],
  'past validity, no grace period',
);
assert.deepEqual(
  deriveAlerts({
    now: NOW,
    latestPing: { at: iso(1), speedKmph: 95 },
    pingsInHaltWindow: [{ at: iso(1), speedKmph: 95 }],
    ewayValidTill: new Date(NOW - 3_600_000).toISOString(),
    thresholds: THRESHOLDS,
  }),
  ['OVERSPEED', 'EWAY_EXPIRED'],
  'multiple simultaneous alerts, order matches the check sequence',
);

// ---- HMAC signature verification ----
const secret = 'a-shared-secret-only-nexraah-and-the-provider-know';
const body = Buffer.from(JSON.stringify({ vehicleNo: 'MH 04 TT 2019', at: '2026-08-16T12:00:00Z', speedKmph: 60 }));
const goodSignature = createHmac('sha256', secret).update(body).digest('hex');
const wrongSecretSignature = createHmac('sha256', 'a-different-secret').update(body).digest('hex');
const tamperedBody = Buffer.from(JSON.stringify({ vehicleNo: 'MH 04 TT 2019', at: '2026-08-16T12:00:00Z', speedKmph: 999 }));

assert.equal(
  constantTimeHexEqual(goodSignature, createHmac('sha256', secret).update(body).digest('hex')),
  true,
  'the same secret over the same bytes verifies',
);
assert.equal(
  constantTimeHexEqual(wrongSecretSignature, createHmac('sha256', secret).update(body).digest('hex')),
  false,
  'a signature made with the wrong secret is rejected',
);
assert.equal(
  constantTimeHexEqual(goodSignature, createHmac('sha256', secret).update(tamperedBody).digest('hex')),
  false,
  'a signature for the original body does not match a tampered one — catches a body rewritten in flight',
);
assert.equal(constantTimeHexEqual('', ''), false, 'empty input is never treated as a valid signature');
assert.equal(constantTimeHexEqual('ab', 'abcd'), false, 'mismatched lengths are rejected, not thrown');

console.log('telematics: all checks passed');
