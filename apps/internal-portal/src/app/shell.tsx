'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { AreaKey, ROLES, RoleCode, navFor } from '@/lib/permissions';
import { Session } from '@/store/atoms';
import { request } from '@/apis';
import { signOut } from '@/lib/auth';
import { Glyph, areaVars } from '@/lib/ui';

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

  const groups = navFor(role);

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
              return (
                <div
                  key={group.label || 'root'}
                  className="nav-area"
                  style={{ ['--area-ink' as string]: ink, ['--area-tint' as string]: tint }}
                >
                  {group.label && (
                    <div className="nav-area-label">
                      {group.emoji && <Glyph size={13}>{group.emoji}</Glyph>}
                      {group.label}
                    </div>
                  )}
                  {group.items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
        onClick={endSession}
        style={{ width: '100%', marginTop: 14, marginBottom: 14 }}
      >
        Sign out
      </button>
    </div>
  );
}
