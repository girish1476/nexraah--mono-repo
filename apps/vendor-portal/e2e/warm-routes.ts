import type { FullConfig } from '@playwright/test';

/**
 * Compiles every route the suite visits, once, before any test runs.
 *
 * These specs run against `next dev`, which builds a route the first time
 * something asks for it. That cost lands on whichever test reaches the route
 * first — and because the app-router holds the URL while the compile
 * finishes, it lands as a `page.goto` timeout or a `toHaveURL` that never
 * settles, rather than as anything that reads like "the page was slow".
 *
 * The symptom is a suite that reddens somewhere different on every run:
 * loads one time, trips the next, always a navigation error, always passing
 * when re-run alone. That reads as flakiness, gets re-run until green, and
 * takes a real regression with it the day one happens.
 *
 * Ported from `apps/internal-portal/e2e/warm-routes.ts`, where it removed the
 * same class of failure. One instance of a dynamic route (`/trips/TR-20881`)
 * compiles `[id]` for every other id too.
 *
 * Purely an optimisation: if the server never comes up, or a route 404s, it
 * gives up and says so rather than failing the run. It asserts nothing.
 */

const ROUTES = [
  '/',
  '/dashboard',
  '/loads',
  '/loads/LD-4471',
  '/loads/LD-4471/quote',
  '/quotes',
  '/trips',
  '/trips/TR-20881',
  '/trips/TR-20881/pod',
  '/trips/TR-20881/bill',
  '/trips/TR-20881/lorry-receipt',
  '/print/lr/TR-20881',
  '/fleet',
  '/profile',
];

/** Three at a time: enough to overlap the waiting, not enough to thrash. */
const LANES = 3;

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
    (config.projects[0]?.use?.baseURL as string | undefined) ?? 'http://localhost:3001';

  // globalSetup can run before the webServer accepts connections, so wait
  // rather than assume — and say so loudly if it never arrives, because a
  // silent skip resurfaces much later as a navigation timeout in whichever
  // spec happened to touch a cold route first.
  const deadline = Date.now() + 60_000;
  while (!(await get(`${base}/loads`, 5_000))) {
    if (Date.now() > deadline) {
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

  // Reported per route rather than as a bare total: a run that warmed none
  // of them must not be able to print the same reassuring line as one that
  // warmed all of them.
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
