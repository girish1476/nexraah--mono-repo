/**
 * The console's working data, kept in the browser between visits.
 *
 * The console runs against an in-memory fixture, and a page reload used to throw
 * every record away — so walking the flow (raise an indent, sign in as another
 * desk, come back tomorrow) lost its own work. In the default, clean mode the data
 * is now saved after every change and put back on the next load.
 *
 * The seeded regression data (`nexraah.demo = 1`, set by the test helpers) is
 * deliberately NOT persisted: those specs rely on every page load starting from
 * the same rows.
 */

// v4 (2 Oct 2026): records saved by earlier versions predate the order cycle
// (tracking sheet, loading marks, E-POD/H-POD, rate basis) and behaved oddly on
// the new screens, so every browser starts again from clean data.
const STORE_KEY = 'nexraah.mockdb.v4';
const RETIRED_KEYS = ['nexraah.mockdb.v3', 'nexraah.mockdb.v2', 'nexraah.mockdb.v1'];
const DEMO_KEY = 'nexraah.demo';

const hasStorage = () => {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
};

/** The rich seeded data set — for the regression suite. Off for real use. */
export function isDemoData(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_DATA === '1') return true;
  try {
    return hasStorage() && window.localStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

/** Puts back what was saved, key by key, into the live objects (never replacing the objects themselves). */
export function hydrate(db: Record<string, any>, branches: any[]): void {
  if (!hasStorage() || isDemoData()) return;
  try {
    // Clear what older versions left behind, so it never fills the storage quota.
    for (const old of RETIRED_KEYS) window.localStorage.removeItem(old);
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, any>;
    for (const key of Object.keys(saved)) {
      if (key === '__branches') continue;
      if (key in db) db[key] = saved[key];
    }
    if (Array.isArray(saved.__branches)) branches.splice(0, branches.length, ...saved.__branches);
  } catch {
    // A corrupt save is not worth refusing to start over: begin from the clean data.
  }
}

/** Fired on `window` when the working data changed under this tab — see `followOtherTabs`. */
export const DATA_CHANGED_EVENT = 'nexraah:data-changed';

/**
 * Keeps this tab's data in step with every other tab of the console.
 *
 * Each tab holds its own copy in memory, so without this a payment released in
 * one tab stayed unreleased in the next until it was reloaded. The browser
 * tells every other tab when the saved data is rewritten; this takes the new
 * data in and announces it, so live screens refresh at once.
 */
export function followOtherTabs(db: Record<string, any>, branches: any[]): void {
  if (!hasStorage() || isDemoData()) return;
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY || !e.newValue) return;
    hydrate(db, branches);
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  });
}

let pending = false;

/** Fired on `window` when the working data could not be saved, and again when a later save goes through. */
export const SAVE_FAILED_EVENT = 'nexraah:save-failed';
export const SAVE_OK_EVENT = 'nexraah:save-ok';
let lastSaveFailed = false;

/** True while the newest work exists only in this tab's memory — the shell says so in a banner. */
export function saveFailing(): boolean {
  return lastSaveFailed;
}

/** Saves the working data. Called after every change; coalesced so a burst is one write. */
export function persist(db: Record<string, any>, branches: any[]): void {
  if (!hasStorage() || isDemoData() || pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    const write = () => window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...db, __branches: branches }));
    try {
      try {
        write();
      } catch {
        // Out of room. Uploaded files used to be kept beside the records and
        // are what filled it; they live in the browser's database now, so the
        // old copy can go, and the records take the room.
        window.localStorage.removeItem('nexraah.mockfiles.v1');
        write();
      }
      if (lastSaveFailed) {
        lastSaveFailed = false;
        window.dispatchEvent(new Event(SAVE_OK_EVENT));
      }
    } catch {
      // Still no room, or storage is blocked. This used to pass in silence, and
      // work done after it vanished on the next reload with nothing said. Now
      // it is announced, so the person knows before they lose it.
      lastSaveFailed = true;
      window.dispatchEvent(new Event(SAVE_FAILED_EVENT));
    }
  });
}

/** Forgets everything saved, so the next load starts from the clean data again. */
export function forgetSaved(): void {
  try {
    if (hasStorage()) window.localStorage.removeItem(STORE_KEY);
  } catch {
    // nothing to do
  }
}

/* ---- the people allowed to sign in -------------------------------------- */

// Who an administrator added, renamed, moved or switched off on Admin → Users.
// Kept apart from the working data so "start fresh" never locks anyone out.
const PEOPLE_KEY = 'nexraah.people.v1';

export interface SavedPeople {
  accounts: { userId: string; name: string; email: string; phone?: string; role: string; branch: string | null }[];
  disabled: string[];
  allowedAt: Record<string, string>;
}

export function savePeople(people: SavedPeople): void {
  if (!hasStorage() || isDemoData()) return;
  try {
    window.localStorage.setItem(PEOPLE_KEY, JSON.stringify(people));
  } catch {
    // Storage full or blocked: the change holds until the page is reloaded.
  }
}

export function loadPeople(): SavedPeople | null {
  if (!hasStorage() || isDemoData()) return null;
  try {
    const raw = window.localStorage.getItem(PEOPLE_KEY);
    return raw ? (JSON.parse(raw) as SavedPeople) : null;
  } catch {
    return null;
  }
}
