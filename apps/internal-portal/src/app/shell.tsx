'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { AreaKey, ROLES, RoleCode, SEED_GRANTS, navFor } from '@/lib/permissions';
import { Session } from '@/store/atoms';
import { request } from '@/apis';
import { signOut } from '@/lib/auth';
import { Glyph, areaVars } from '@/lib/ui';
import { useTheme } from '@/lib/theme';
import { ReportProblemButton } from './tickets/report-button';

/**
 * A nav href without its query string.
 *
 * Three delivery-proof rows are presets of two screens — `/pod/pending`,
 * `/pod/pending?ageing=breached`, `/pod/receiving?attached=1` — so anything
 * comparing a row against the current path has to drop the query first.
 */
function hrefPath(href: string): string {
  const q = href.indexOf('?');
  return q === -1 ? href : href.slice(0, q);
}

/**
 * Sidebar, identity strip and the pending-approvals badge.
 *
 * A module the signed-in role lacks is **absent** from this navigation, never
 * greyed (part 01 §2.2). The role is read from the session the server issued
 * and cannot be changed from here — the prototype switcher that used to sit
 * at the foot went out with `lib/dev-tokens.ts`.
 *
 * The nav itself was rebuilt around what stakeholders actually rejected. It
 * was twenty rows of schema nouns — Vendors, Indents, POD receiving, RFQ,
 * P&L — each with a 16px grey line icon, in one undifferentiated column. Now
 * it is five areas, each with a hue and an emoji, each row a 40px target
 * carrying a glyph chip and a plain-language label. Colour, picture and word
 * always agree; none of the three is ever the only thing carrying meaning.
 */
export function Shell({ session, children }: { session: Session | null; children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const role: RoleCode = session?.role ?? 'OPS';
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  /*
   * Which areas the person has opened or closed by hand. Absent means "not
   * touched", which falls back to opening whichever area holds the page they
   * are on — so the sidebar never hides the section you are standing in, and a
   * deliberate close is still respected.
   */
  const [openAreas, setOpenAreas] = useState<Record<string, boolean>>({});
  /*
   * The current URL including its query, for matching the preset rows.
   *
   * From `window.location` in an effect rather than `useSearchParams()`: this
   * component wraps every page in the console, and reading search params here
   * would push the whole app behind a Suspense boundary at build time for a
   * string used only to underline a sidebar row. `pathname` is in the
   * dependency list so a client-side navigation re-reads it.
   */
  const [currentHref, setCurrentHref] = useState('');
  useEffect(() => {
    setCurrentHref(`${window.location.pathname}${window.location.search}`);
  }, [pathname]);

  useEffect(() => {
    if (!session) return;
    request<any[]>({ url: '/approvals', method: 'GET', params: { status: 'PENDING' } })
      .then((rows) =>
        setPendingApprovals(
          rows.filter((r) => (session.permissions ?? []).includes(r.requiredPermission)).length,
        ),
      )
      .catch(() => setPendingApprovals(0));
  }, [session, pathname]);

  // Route change closes the drawer — otherwise a tap on a nav link would
  // leave it open behind the new page on mobile.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // The grants the server issued, with the same fallback `permissionsAtom`
  // uses — so a row gated on a permission shows exactly when the page's own
  // button would.
  const groups = navFor(role, session?.permissions?.length ? session.permissions : SEED_GRANTS[role]);

  /**
   * True when a preset row (one carrying a query string) matches the URL we
   * are on. While it does, the plain row sharing that path stands down — so
   * "Delivery proof pending" and "Delivery proof past due" are never both
   * underlined.
   */
  const presetClaims = groups.some((g) =>
    g.items.some((i) => i.href.includes('?') && i.href === currentHref),
  );

  return (
    <div>
      <div className="mobile-topbar no-print">
        {/* Always the "open" trigger: once the drawer is open it covers this
            bar (higher z-index), so a "close" state here would never be
            reachable — closing goes through the drawer's own button or the
            backdrop instead. */}
        <button
          aria-label="Open menu"
          onClick={() => setNavOpen(true)}
          style={{
            background: 'none',
            border: '1px solid var(--color-divider)',
            borderRadius: 'var(--radius-sm)',
            width: 38,
            height: 38,
            display: 'grid',
            placeItems: 'center',
            flex: 'none',
            color: 'var(--color-text)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 17 }}>Nexraah</div>
        {/* On a phone the sidebar is behind a hamburger, so the one badge that
            means "somebody is waiting on you" has to survive out here too. */}
        {pendingApprovals > 0 && (
          <Link
            href="/admin/approvals"
            className="nav-badge"
            style={{ marginLeft: 'auto', textDecoration: 'none' }}
            aria-label={`${pendingApprovals} approvals waiting for you`}
          >
            {pendingApprovals}
          </Link>
        )}
      </div>
      <div
        className={`nav-backdrop no-print${navOpen ? ' open' : ''}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'flex-start' }}>
        <aside
          className={`no-print sidebar${navOpen ? ' open' : ''}`}
          style={{
            flex: 'none',
            width: 'var(--sidebar-w)',
            borderRight: '1px solid var(--color-divider)',
            background: 'var(--color-surface)',
            minHeight: '100vh',
            padding: '18px 0 20px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '2px 16px 16px', display: 'flex', alignItems: 'center', gap: 11 }}>
            <div
              aria-hidden
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                background: 'linear-gradient(150deg, var(--color-accent-400), var(--color-accent-700))',
                color: '#fff',
                fontFamily: 'var(--font-heading)',
                fontWeight: 800,
                fontSize: 17,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              N
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 19, lineHeight: 1.15 }}>
                Nexraah
              </div>
              <div className="eyebrow" style={{ marginTop: 1 }}>
                Freight desk
              </div>
            </div>
            {/* Sits above the mobile topbar's own hamburger/X (z-index) when the
                drawer is open, so the drawer always has a reachable dismiss
                control instead of relying solely on the backdrop tap. */}
            <button
              className="sidebar-close-btn"
              aria-label="Close menu"
              onClick={() => setNavOpen(false)}
              style={{
                background: 'none',
                border: '1px solid var(--color-divider)',
                borderRadius: 'var(--radius-sm)',
                width: 32,
                height: 32,
                placeItems: 'center',
                flex: 'none',
                color: 'var(--color-text)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <nav style={{ padding: '4px 12px', flex: 1, overflowY: 'auto' }}>
            {groups.map((group) => {
              const area: AreaKey = group.area ?? 'desk';
              const { ink, tint } = areaVars(area);
              /*
               * Every titled area collapses, at the owner's direction ("show
               * all the sub-sections with dropdown options").
               *
               * **Open by default**, and that is the whole of the decision.
               * Collapsing them on first load would fold away five of the six
               * areas for everybody — every screen you were not already
               * standing on would take two clicks instead of one, on a console
               * whose stated problem was that people could not find things.
               * The fold is there for somebody who wants to put an area away,
               * not a state to arrive in.
               */
              const open = !group.label || (openAreas[group.label] ?? true);
              return (
                <div
                  key={group.label || 'root'}
                  className="nav-area"
                  style={{ ['--area-ink' as string]: ink, ['--area-tint' as string]: tint }}
                >
                  {group.label && (
                    <button
                      type="button"
                      className="nav-area-label nav-area-toggle"
                      aria-expanded={open}
                      onClick={() =>
                        setOpenAreas((current) => ({ ...current, [group.label]: !open }))
                      }
                    >
                      {group.emoji && <Glyph size={13}>{group.emoji}</Glyph>}
                      <span style={{ flex: 1, textAlign: 'left' }}>{group.label}</span>
                      <span className="nav-area-count">{group.items.length}</span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        style={{
                          transform: open ? 'rotate(180deg)' : 'none',
                          transition: 'transform 140ms ease',
                          flex: 'none',
                        }}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  )}
                  {open &&
                    group.items.map((item) => {
                    /*
                     * Three of the delivery-proof rows are presets of two
                     * screens (`?ageing=breached`, `?attached=1`), so matching
                     * on pathname alone would light up every row sharing a
                     * path. An exact match wins; a plain row falls back to the
                     * path, but only while no preset row has claimed the
                     * current URL — otherwise "pending" and "past due" would
                     * both look current at once.
                     */
                    const path = hrefPath(item.href);
                    const active = item.href.includes('?')
                      ? item.href === currentHref
                      : (pathname === path || pathname.startsWith(`${path}/`)) && !presetClaims;
                    const badge =
                      item.module === 'approvals' && pendingApprovals > 0 ? pendingApprovals : null;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={active ? 'nav-item is-active' : 'nav-item'}
                        aria-current={active ? 'page' : undefined}
                        title={item.note}
                      >
                        <Glyph chip tint={tint} size={15}>
                          {item.emoji ?? '•'}
                        </Glyph>
                        <span className="nav-item-label">{item.label}</span>
                        {badge && (
                          <span className="nav-badge" aria-label={`${badge} waiting`}>
                            {badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <RoleStrip role={role} session={session} />
        </aside>

        <main className="app-main" style={{ flex: 1, minWidth: 0, padding: '24px 30px 72px' }}>
          {children}

          {/*
            "Ticketing should be available for every dashboard."

            Mounted in the shell rather than added page by page, because a
            screen that forgot it is exactly the screen somebody will be
            standing on when they find something wrong. It captures the route
            itself, so no page has to pass anything for it to be useful.

            Below the content, not in the header: reporting a problem is
            never the reason you opened a screen, and a control that competes
            with the page's own actions gets pressed by mistake.
          */}
          <div
            className="no-print"
            style={{
              marginTop: 40,
              paddingTop: 16,
              borderTop: '1px solid var(--color-divider)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span className="hint" style={{ flex: 1, minWidth: 200 }}>
              Something on this screen wrong or missing? Tell Administration — they can correct it.
            </span>
            <ReportProblemButton />
          </div>
        </main>
      </div>
    </div>
  );
}

function RoleStrip({ role, session }: { role: RoleCode; session: Session | null }) {
  // The "🧪 Switch role (testing only)" dropdown that used to sit here is
  // gone along with `lib/dev-tokens.ts`. It worked by swapping in another
  // seat's pre-signed JWT, which only had anything to swap *to* because six
  // of them were checked into the repo. With a password screen, becoming
  // another person means signing in as them — the same thing this button
  // starts, one step earlier.
  //
  // router.push, not window.location — a hard navigation re-executes every
  // JS module from scratch, which would silently reset the mock adapter's
  // in-memory `db` back to its seed data on sign-out. Client-side routing
  // keeps the same module instance, so anything created during a test pass
  // survives.
  const router = useRouter();
  const [theme, toggleTheme] = useTheme();
  const endSession = () => {
    signOut();
    router.push('/signin');
  };
  const initials = (session?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={{ padding: '14px 16px 2px', borderTop: '1px solid var(--color-divider)', marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: 'var(--radius-pill)',
            flex: 'none',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--color-accent-tint)',
            color: 'var(--color-accent-700)',
            fontSize: 13,
            fontWeight: 700,
            border: '1px solid var(--color-divider)',
          }}
        >
          {initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {session?.name ?? 'Signing in…'}
          </div>
          <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            {ROLES[role].label}
          </div>
        </div>
      </div>
      {/* Branch scope is the difference between "12 loads are late" meaning
          your branch or the whole company. It was set in monospace, which
          read as a code; it is a place, so it reads as one. */}
      <div
        style={{
          fontSize: 'var(--text-sm)',
          marginTop: 9,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--color-text-soft)',
        }}
      >
        <Glyph size={13}>{session?.branch ? '🏬' : '🌐'}</Glyph>
        {session?.branch ? `${session.branch.name} branch` : 'All branches'}
      </div>

      <button
        className="btn btn-secondary btn-sm"
        onClick={toggleTheme}
        aria-pressed={theme === 'dark'}
        style={{ width: '100%', marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
      >
        <Glyph size={13}>{theme === 'dark' ? '☀️' : '🌙'}</Glyph>
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>

      <button
        className="btn btn-secondary btn-sm"
        onClick={endSession}
        style={{ width: '100%', marginTop: 8, marginBottom: 14 }}
      >
        Sign out
      </button>
    </div>
  );
}
