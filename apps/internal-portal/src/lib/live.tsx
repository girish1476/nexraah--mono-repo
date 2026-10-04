'use client';

import { useEffect, useRef, useState } from 'react';

/** Same name as `DATA_CHANGED_EVENT` in `mocks/persist.ts`; repeated so the page code never imports the fixture. */
const DATA_CHANGED_EVENT = 'nexraah:data-changed';

/**
 * Keeps a screen's data current without anybody pressing reload.
 *
 * `refresh` is re-run every `everyMs` while the tab is on screen, at once when
 * the person comes back to the tab, and at once when another tab changes the
 * data. A hidden tab does not poll — nobody is looking, and a dozen background
 * tabs should not each be hitting the API.
 *
 * A failed refresh is swallowed: the screen keeps what it last showed rather
 * than swapping a working page for an error over one dropped request. The next
 * tick tries again. The screen's own first load still reports errors as before.
 *
 * Returns when the data was last refreshed, for a "Live · updated" stamp.
 */
export function useLiveRefresh(refresh: () => Promise<unknown> | void, everyMs = 30_000): Date | null {
  const latest = useRef(refresh);
  latest.current = refresh;
  const [at, setAt] = useState<Date | null>(null);

  useEffect(() => {
    let running = false;
    const run = () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      Promise.resolve()
        .then(() => latest.current())
        .then(() => setAt(new Date()))
        .catch(() => undefined)
        .finally(() => {
          running = false;
        });
    };
    const onVisible = () => document.visibilityState === 'visible' && run();

    setAt(new Date());
    const timer = setInterval(run, everyMs);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener(DATA_CHANGED_EVENT, run);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener(DATA_CHANGED_EVENT, run);
    };
  }, [everyMs]);

  return at;
}

/** "● Live · updated 10:42:07" — says the numbers on screen are current, and how current. */
export function LiveStamp({ at }: { at: Date | null }) {
  if (!at) return null;
  return (
    <span className="muted" style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--mint)' }}
      />
      Live · updated {at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}
