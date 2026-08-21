'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { ROLES, ROLE_CODES, RoleCode, levelFor, navFor } from '@/lib/permissions';
import { DEV_TOKENS } from '@/lib/dev-tokens';
import { Session } from '@/store/atoms';
import { request } from '@/apis';
import { ModuleIcon } from '@/lib/ui';

/**
 * Sidebar, role strip and the pending-approvals badge.
 *
 * A module the signed-in role lacks is **absent** from this navigation, never
 * greyed (part 01 §2.2). The role switcher at the foot is prototype control —
 * it writes `localStorage.role`, which the mock adapter reads and a real
 * `internal-api` ignores. Delete it when Supabase auth lands.
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
            width: 34,
            height: 34,
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
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16 }}>Nexraah</div>
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
            boxShadow: '1px 0 0 rgba(15, 30, 60, 0.02), 2px 0 12px rgba(15, 30, 60, 0.03)',
          }}
        >
        <div style={{ padding: '2px 18px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            aria-hidden
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              flex: 'none',
              display: 'grid',
              placeItems: 'center',
              background: 'linear-gradient(155deg, var(--color-accent-400), var(--color-accent-800))',
              color: '#fff',
              fontFamily: 'var(--font-heading)',
              fontWeight: 700,
              fontSize: 15,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            N
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, lineHeight: 1.15 }}>
              Nexraah
            </div>
            <div className="eyebrow" style={{ marginTop: 1 }}>
              Internal console
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
              width: 30,
              height: 30,
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

        <nav style={{ padding: '6px 10px', flex: 1, overflowY: 'auto' }}>
          {groups.map((group) => (
            <div key={group.label || 'root'} style={{ marginBottom: 12 }}>
              {group.label && (
                <div className="eyebrow" style={{ padding: '10px 8px 6px' }}>
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const readOnly = levelFor(item.module, role) === 'VIEW';
                const badge = item.module === 'approvals' && pendingApprovals > 0 ? pendingApprovals : null;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="nav-item"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      marginBottom: 1,
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 13.5,
                      fontWeight: active ? 600 : 500,
                      textDecoration: 'none',
                      background: active ? 'color-mix(in srgb, var(--color-accent) 11%, transparent)' : 'transparent',
                      color: active ? 'var(--color-accent-700)' : 'var(--color-text)',
                    }}
                  >
                    <span style={{ display: 'flex', flex: 'none', color: active ? 'var(--color-accent-700)' : 'var(--color-neutral-700)' }}>
                      <ModuleIcon module={item.module} size={16.5} />
                    </span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {readOnly && (
                      <span className="eyebrow" style={{ fontSize: 8.5 }}>
                        Read
                      </span>
                    )}
                    {badge && (
                      <span
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          minWidth: 17,
                          height: 17,
                          borderRadius: 'var(--radius-pill)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'var(--red)',
                          color: '#fff',
                          fontWeight: 600,
                        }}
                      >
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

          <RoleStrip role={role} session={session} />
        </aside>

        <main className="app-main" style={{ flex: 1, minWidth: 0, padding: '22px 28px 64px' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

function RoleStrip({ role, session }: { role: RoleCode; session: Session | null }) {
  // Against the real backend, role comes from the JWT alone — writing
  // `localStorage.role` (the old mock-only switcher) relabels the sidebar
  // without changing who the server thinks is signed in, so the next
  // request still runs as the old role and gets denied by the module the
  // new role's landing page expects to be able to see. Switching for real
  // means signing in with that role's token, same as `/dev-login`.
  const switchRole = (code: RoleCode) => {
    localStorage.setItem('token', DEV_TOKENS[code].token);
    localStorage.removeItem('role');
    window.location.href = ROLES[code].landsOn;
  };
  const initials = (session?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={{ padding: '14px 14px 2px', borderTop: '1px solid var(--color-divider)', marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: 'var(--radius-pill)',
            flex: 'none',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--color-accent-tint, var(--grey-tint))',
            color: 'var(--color-accent-700)',
            fontSize: 11.5,
            fontWeight: 700,
            border: '1px solid var(--color-divider)',
          }}
        >
          {initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {session?.name ?? 'Signing in…'}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {ROLES[role].label}
          </div>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 10.5, marginTop: 8, color: 'var(--color-accent-700)' }}>
        {session?.branch ? `${session.branch.name} branch` : 'All branches'}
      </div>

      {/* Prototype control — not part of the product. */}
      <div className="eyebrow" style={{ marginTop: 12 }}>
        Signed in as
      </div>
      <select
        value={role}
        onChange={(e) => switchRole(e.target.value as RoleCode)}
        style={{
          width: '100%',
          marginTop: 5,
          marginBottom: 12,
          padding: '7px 9px',
          fontSize: 12,
          fontFamily: 'inherit',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-divider)',
          background: 'var(--color-bg)',
          cursor: 'pointer',
        }}
      >
        {ROLE_CODES.map((code) => (
          <option key={code} value={code}>
            {code} · {ROLES[code].label}
          </option>
        ))}
      </select>
    </div>
  );
}
