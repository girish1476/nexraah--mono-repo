// Runnable check for the POD penalty clock — the one place the portal computes money.
// `node scripts/check-pod-clock.mjs` from apps/vendor-portal. No test framework:
// typescript is already a devDependency, so transpile the two modules and run them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compile = (path) =>
  ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 },
  }).outputText;

const source = compile('src/app/trips/pod-clock.ts')
  // The module's only imports are a type and the ₹ formatter; inline the latter.
  .replace(/^import[^\n]*\n/gm, '')
  .replace(
    /^/,
    "const inr = (p) => '\\u20B9' + Math.round(p / 100).toLocaleString('en-IN');\n",
  );

const { podClock } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);

const PER_DAY = 10000; // ₹100/day in paise — BR-24

// Inside the window (BR-12)
assert.equal(podClock(0, PER_DAY).headline, '20 days left in the window');
assert.equal(podClock(19, PER_DAY).headline, '1 day left in the window');
assert.equal(podClock(20, PER_DAY).penaltyPaise, 0, 'day 20 is still free');
assert.equal(podClock(20, PER_DAY).tone, 'mint');

// Past the window (BR-24) — day 21 is ₹100, day 24 is ₹400
assert.equal(podClock(21, PER_DAY).penaltyPaise, 10000);
assert.match(podClock(21, PER_DAY).headline, /^₹100 deducted so far — 1 day over$/);
assert.equal(podClock(24, PER_DAY).penaltyPaise, 40000);
assert.match(podClock(24, PER_DAY).headline, /₹400 deducted so far — 4 days over/);
assert.equal(podClock(40, PER_DAY).penaltyPaise, 200000);
assert.equal(podClock(24, PER_DAY).forfeited, false);

// Past 40 days nothing is payable (BR-25) and the state is terminal
assert.equal(podClock(41, PER_DAY).forfeited, true);
assert.match(podClock(41, PER_DAY).headline, /no balance is payable/);

console.log('pod-clock: all checks passed');
