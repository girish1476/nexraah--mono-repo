'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { ROLES, ROLE_CODES, RoleCode, levelFor, navFor } from '@/lib/permissions';
import { Session } from '@/store/atoms';
import { request } from '@/apis';

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

  const groups = navFor(role);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'flex-start' }}>
      <aside
        className="no-print"
        style={{
          flex: 'none',
          width: 'var(--sidebar-w)',
          borderRight: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
          minHeight: '100vh',
          padding: '20px 0 24px',
          position: 'sticky',
          top: 0,
          alignSelf: 'stretch',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '0 18px 16px', borderBottom: '1px solid var(--color-divider)' }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 21 }}>Nexraah</div>
          <div className="eyebrow" style={{ marginTop: 2 }}>
            Internal console
          </div>
        </div>

        <nav style={{ padding: '14px 0', flex: 1, overflowY: 'auto' }}>
          {groups.map((group) => (
            <div key={group.label || 'root'} style={{ marginBottom: 14 }}>
              {group.label && (
                <div className="eyebrow" style={{ padding: '0 18px 5px' }}>
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
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 18px',
                      fontSize: 13.5,
                      textDecoration: 'none',
                      borderLeft: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
                      background: active ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
                      color: active ? 'var(--color-accent-700)' : 'var(--color-text)',
                    }}
                  >
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
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'var(--red)',
                          color: '#fff',
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

      <main style={{ flex: 1, minWidth: 0, padding: '22px 26px 64px' }}>{children}</main>
    </div>
  );
}

function RoleStrip({ role, session }: { role: RoleCode; session: Session | null }) {
  const switchRole = (code: RoleCode) => {
    localStorage.setItem('role', code);
    window.location.href = ROLES[code].landsOn;
  };

  return (
    <div style={{ padding: '14px 18px 0', borderTop: '1px solid var(--color-divider)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{session?.name ?? 'Signing in…'}</div>
      <div className="muted" style={{ fontSize: 11 }}>
        {ROLES[role].label}
      </div>
      <div className="mono" style={{ fontSize: 10.5, marginTop: 4, color: 'var(--color-accent-700)' }}>
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
          marginTop: 4,
          padding: '6px 8px',
          fontSize: 12,
          fontFamily: 'inherit',
          border: '1px solid var(--color-divider)',
          background: 'var(--color-bg)',
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
