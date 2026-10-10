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
import { Assistant } from '@/components/assistant';
import { ReportProblemButton } from './tickets/report-button';

/**
 * A nav href without its query string.
 *
 * No row in `NAV` currently carries one, but a row that pointed at a preset
 * of another screen — `/pod/pending?ageing=breached` was one, before the
 * delivery-proof rows collapsed into the single "Check POD status" row —
 * would need this to match against the current path, so it stays rather
 * than being re-added the next time one does.
 */
const SIDEBAR_KEY = 'nexraah-sidebar';

function hrefPath(href: string): string {
  const q = href.indexOf('?');
  return q === -1 ? href : href.slice(0, q);
}

/**
 * Sidebar, the top bar (who is signed in, light/dark, sign out) and the
 * pending-approvals badge.
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
   * The desktop sidebar folds away to give a wide table or a map the whole
   * screen, from the button in its own header. The choice is kept in
   * this browser, like the theme, so it holds from screen to screen. (On a
   * phone the sidebar is already a drawer — `navOpen` above.)
   */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === 'closed');
    } catch {
      // Storage blocked: the sidebar simply starts open.
    }
  }, []);
  const toggleSidebar = () => {
    setCollapsed((was) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, was ? 'open' : 'closed');
      } catch {
        // Storage blocked: the choice holds until the page is reloaded.
      }
      return !was;
    });
  };
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
  const groups = navFor(
    role,
    session?.customRole
      ? (session.permissions ?? [])
      : session?.permissions?.length
        ? session.permissions
        : SEED_GRANTS[role],
  );

  /**
   * True when a preset row (one carrying a query string) matches the URL we
   * are on. While it does, the plain row sharing that path stands down — so
   * "Delivery proof pending" and "Delivery proof past due" are never both
   * underlined.
   */
  const presetClaims = groups.some((g) =>
    g.items.some((i) => i.href.includes('?') && i.href === currentHref),
  );

  /**
   * The one plain row that is the screen we are on: the longest row path the
   * URL sits under. "/clients/verification" sits under both "/clients" and
   * "/clients/verification"; matching on "starts with" alone lit both rows at
   * once. The longest match is the screen itself, and only it is marked.
   */
  const currentRowPath = groups
    .flatMap((g) => g.items)
    .filter((i) => !i.href.includes('?'))
    .map((i) => hrefPath(i.href))
    .filter((p) => pathname === p || pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/logo.png" alt="" aria-hidden width={24} height={24} style={{ borderRadius: 7, flex: 'none' }} />
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 17 }}>Nexraah</div>
        </div>
        {/* On a phone the sidebar is behind a hamburger, so the one badge that
            means "somebody is waiting on you" has to survive out here too. */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {pendingApprovals > 0 && (
            <Link
              href="/admin/approvals"
              className="nav-badge"
              style={{ textDecoration: 'none' }}
              aria-label={`${pendingApprovals} approvals waiting for you`}
            >
              {pendingApprovals}
            </Link>
          )}
          <UserBar role={role} session={session} compact />
        </div>
      </div>
      <div
        className={`nav-backdrop no-print${navOpen ? ' open' : ''}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'flex-start' }}>
        <aside
          className={`no-print sidebar${navOpen ? ' open' : ''}${collapsed ? ' is-collapsed' : ''}`}
          style={{
            flex: 'none',
            width: 'var(--sidebar-w)',
            borderRight: '1px solid var(--color-divider)',
            background: 'var(--color-surface)',
            minHeight: '100vh',
            padding: '0 0 20px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div className="sidebar-brand" style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 11 }}>
            <img
              src="/logo.png"
              alt=""
              aria-hidden
              width={36}
              height={36}
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                flex: 'none',
                boxShadow: 'var(--shadow-sm)',
                objectFit: 'cover',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 19, lineHeight: 1.15 }}>
                Nexraah
              </div>
              <div className="eyebrow" style={{ marginTop: 1 }}>
                Freight desk
              </div>
            </div>
            {/* The desktop open/close control lives here, in the sidebar's own
                header. Folded, the sidebar is off the screen and takes this
                button with it, so the top bar carries the way back. */}
            <button
              type="button"
              className="userbar-menu sidebar-toggle"
              aria-label="Hide the menu"
              aria-expanded={!collapsed}
              title="Hide the menu"
              onClick={toggleSidebar}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <path d="M9 4v16" />
                <path className="userbar-menu-arrow" d="M16 9.5 13.5 12l2.5 2.5" />
              </svg>
            </button>
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
               * **Closed by default**, reversed 2026-09-20 from the original
               * open-by-default call — the owner wants a short, scannable
               * list of areas to arrive on, expanding only the one they click
               * into, not five open accordions stacked on top of each other.
               * The three ungrouped desk rows (`!group.label`) are exempt —
               * there is nothing to fold there, and they should always be one
               * click away regardless of this default.
               */
              const open = !group.label || (openAreas[group.label] ?? false);
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
                      {/* A clear open/close control: + when the group is folded, turning into − as it opens. */}
                      <span className="nav-area-icon" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
                          <path d="M5 12h14" />
                          <path className="nav-area-icon-bar" d="M12 5v14" />
                        </svg>
                      </span>
                    </button>
                  )}
                  {/*
                    CSS-hidden rather than left unrendered when closed: a
                    permission gate (`rbac-nav.spec.ts`) checks a role's
                    offered routes by finding the `<a href>` in the sidebar,
                    which a collapsed-away group would make indistinguishable
                    from a route the role simply doesn't hold — the very
                    thing that test exists to catch. `hidden` keeps every row
                    real and reachable by a direct link or a script, just not
                    painted, which is also what stops the group from losing
                    its scroll position or remounting each time it opens.

                    A class rather than the `hidden` attribute, so the rows
                    slide open and shut instead of snapping; closed, they are
                    `visibility: hidden` — not painted, not focusable.
                  */}
                  <div className={open ? 'nav-area-rows is-open' : 'nav-area-rows'}>
                    <div className="nav-area-rows-inner">
                    {group.items.map((item) => {
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
                        : path === currentRowPath && !presetClaims;
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
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        <main className="app-main" style={{ flex: 1, minWidth: 0, padding: '24px 30px 72px' }}>
          <div className="userbar no-print">
            {collapsed && (
              <button
                type="button"
                className="userbar-menu is-reopen"
                aria-label="Show the menu"
                aria-expanded={false}
                title="Show the menu"
                onClick={toggleSidebar}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2.5" />
                  <path d="M9 4v16" />
                  <path className="userbar-menu-arrow" d="M13.5 9.5 16 12l-2.5 2.5" />
                </svg>
              </button>
            )}
            <UserBar role={role} session={session} />
          </div>
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
        {/* On every screen, like the ticket button — a question comes up wherever the person happens to be. */}
        <Assistant />
      </div>
    </div>
  );
}

/**
 * Who is signed in, the light/dark switch and sign-out — on the top bar.
 *
 * These sat at the foot of the sidebar, under the navigation, where signing
 * out meant scrolling a menu. They are not navigation, so they are out of that
 * panel and stay in the top right corner of every screen.
 *
 * `compact` is the phone bar: no room for the name beside the menu button and
 * the logo, so the initials stand for the person there.
 */
function UserBar({ role, session, compact = false }: { role: RoleCode; session: Session | null; compact?: boolean }) {
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
  const name = session?.name ?? 'Signing in…';
  const roleLabel = session?.roleLabel ?? ROLES[role].label;
  // Branch scope is the difference between "12 loads are late" meaning your
  // branch or the whole company, so it stays beside the role.
  const scope = session?.branch ? `${session.branch.name} branch` : 'All branches';
  const initials = (session?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const dark = theme === 'dark';

  return (
    <div className="userbar-items">
      <div className="userbar-who" title={compact ? `${name} · ${roleLabel} · ${scope}` : undefined}>
        <div className="userbar-avatar" aria-hidden={!compact} aria-label={compact ? `${name}, ${roleLabel}, ${scope}` : undefined}>
          {initials}
        </div>
        {!compact && (
          <div style={{ minWidth: 0 }}>
            <div className="userbar-name">{name}</div>
            <div className="muted userbar-role">
              {roleLabel} · <Glyph size={12}>{session?.branch ? '🏬' : '🌐'}</Glyph> {scope}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label="Dark mode"
        title={dark ? 'Dark mode is on' : 'Dark mode is off'}
        className={dark ? 'theme-switch is-on' : 'theme-switch'}
        onClick={toggleTheme}
      >
        <span className="theme-switch-knob" aria-hidden>
          {dark ? '🌙' : '☀️'}
        </span>
      </button>

      <button type="button" className="userbar-signout" aria-label="Sign out" title="Sign out" onClick={endSession}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      </button>
    </div>
  );
}
