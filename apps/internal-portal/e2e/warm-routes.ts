import type { FullConfig } from '@playwright/test';

/**
 * Compiles every route the suite navigates to, once, before any test runs.
 *
 * These specs run against `next dev`, which builds a route the first time
 * something asks for it. That cost lands on whichever test happens to reach
 * the route first — and because the app-router holds the URL until the
 * compile finishes, it lands as a `toHaveURL` timing out rather than as
 * anything that reads like "the page was slow".
 *
 * The result was a suite that reddened in a different place on every run:
 * indents one time, rfq the next, trips the one after, always a navigation
 * assertion, always passing when re-run on its own. That pattern is worse
 * than a plain failure — it trains people to re-run until green, which is
 * exactly how a real regression gets waved through.
 *
 * Warming here moves that cost to one place, before the run, where it is
 * visible and costs nothing but a few seconds. One instance of a dynamic
 * route (`/trips/t-120881`) compiles `[id]` for every other id too.
 *
 * Purely an optimisation: if the server is not up yet, or a route 404s, this
 * gives up quietly rather than failing the run. It never asserts anything.
 */

const ROUTES = [
  '/signin',
  '/today',
  '/home',
  '/orders',
  '/indents',
  '/indents/new',
  '/indents/i-4443',
  '/trips',
  '/trips/t-120881',
  '/trips/t-120881/documents',
  '/trips/t-120881/charges',
  '/trips/t-120881/lr',
  '/pod/pending',
  '/pod/receiving',
  '/pod/t-120869/verify',
  '/payments/advance',
  '/payments/balance',
  '/payments/bills',
  '/invoices',
  '/invoices/new',
  '/invoices/inv-411',
  '/receivables',
  '/clients',
  '/clients/new',
  '/clients/c-0092',
  '/vendors',
  '/vendors/new',
  '/vendors/issues',
  '/vendors/market-gap',
  '/rfq',
  '/rfq/new',
  '/rfq/rfq-2',
  '/compliance',
  '/telematics',
  '/pnl',
  '/admin',
  '/admin/roles',
  '/admin/approvals',
  '/admin/branches',
  '/admin/import',
];

/** Four at a time: enough to overlap the waiting, not enough to thrash. */
const LANES = 4;

async function get(url: string, timeoutMs: number): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    await fetch(url, { signal: abort.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default async function warmRoutes(config: FullConfig): Promise<void> {
  const base =
    (config.projects[0]?.use?.baseURL as string | undefined) ?? 'http://localhost:3002';

  // globalSetup can run before the webServer is accepting connections, so
  // wait for it rather than assuming — and simply skip warming if it never
  // arrives, since the tests themselves will report that far more clearly.
  const deadline = Date.now() + 60_000;
  while (!(await get(`${base}/signin`, 5_000))) {
    if (Date.now() > deadline) {
      // Loudly, because a silent skip here resurfaces much later as a random
      // `toHaveURL` timeout in whichever spec happened to touch a cold route
      // first — which reads as a flaky test rather than as warming not having
      // run at all.
      // eslint-disable-next-line no-console
      console.warn('WARNING: dev server never came up — route warming SKIPPED');
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  const queue = [...ROUTES];
  const failed: string[] = [];
  const started = Date.now();
  await Promise.all(
    Array.from({ length: LANES }, async () => {
      for (let route = queue.shift(); route; route = queue.shift()) {
        if (!(await get(`${base}${route}`, 90_000))) failed.push(route);
      }
    }),
  );

  // The count used to be reported unconditionally, whether or not any route
  // actually compiled — `get()`'s result was discarded. So a run could print
  // "warmed 40 routes" having warmed none of them, and the cost showed up
  // later as a navigation assertion timing out on a route the log had just
  // claimed was ready. Naming the misses makes that impossible to misread.
  const seconds = Math.round((Date.now() - started) / 1000);
  // eslint-disable-next-line no-console
  console.log(`warmed ${ROUTES.length - failed.length}/${ROUTES.length} routes in ${seconds}s`);
  if (failed.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `WARNING: ${failed.length} route(s) did not warm: ${failed.join(', ')} — ` +
        'navigation assertions against these may time out.',
    );
  }
}
