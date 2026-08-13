'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/apis';
import {
  FIXED_PERMISSIONS,
  GRANTABLE_ANYWHERE,
  Level,
  MODULE_ACCESS,
  MODULE_LABEL,
  ModuleKey,
  PERMISSIONS,
  Permission,
  ROLE_CODES,
  RoleCode,
} from '@/lib/permissions';
import { ErrorState, Loading, ModuleGuard, PageHeader, Panel, Stack, useCan, useToast } from '@/lib/ui';
import { getRoleMatrix, setPermission } from './apis';
import { RoleMatrixResponse } from './types';

/**
 * Roles matrix — `/admin/roles`.
 *
 * Two tables, because BR-29 and part 01 §2.4 are two different things:
 * the module matrix (None/View/Edit per screen group) and the named
 * permissions, four of which are fixed and cannot be moved by anybody.
 */
export default function RolesMatrixPage() {
  const can = useCan();
  const toast = useToast();
  const editable = can('config.manage');

  const [data, setData] = useState<RoleMatrixResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getRoleMatrix().then(setData).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const held = useMemo(() => {
    if (!data) return {} as Record<RoleCode, Set<string>>;
    const out = {} as Record<RoleCode, Set<string>>;
    ROLE_CODES.forEach((role) => {
      const base = new Set<string>(data.grants[role] ?? []);
      Object.entries(data.matrix[role] ?? {}).forEach(([permission, level]) => {
        if (level === 'NONE') base.delete(permission);
        else base.add(permission);
      });
      out[role] = base;
    });
    return out;
  }, [data]);

  const toggle = async (role: RoleCode, permission: Permission) => {
    const has = held[role]?.has(permission);
    try {
      await setPermission(role, permission, has ? 'NONE' : 'EDIT');
      setData((prev) =>
        prev
          ? {
              ...prev,
              matrix: {
                ...prev.matrix,
                [role]: { ...(prev.matrix[role] ?? {}), [permission]: has ? 'NONE' : 'EDIT' },
              },
            }
          : prev,
      );
      toast(`${permission} ${has ? 'removed from' : 'granted to'} ${role} · audited`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const modules = Object.keys(MODULE_ACCESS) as ModuleKey[];

  return (
    <ModuleGuard module="admin">
      <PageHeader
        path="/admin/roles"
        title="Roles matrix"
        sub="Who sees what · six internal roles. The transporter portal is a separate application."
        module="admin"
      />

      {error && <ErrorState message={error} retry={load} />}
      {!data && !error && <Loading what="Loading the matrix" />}

      {data && (
        <Stack>
          <div
            className="surface"
            style={{ borderLeft: '2px solid var(--color-accent)', padding: '11px 13px', fontSize: 12.5 }}
          >
            {editable
              ? 'You may grant any permission except the four marked Fixed. payment.release is not grantable to a second role by anyone, including an administrator. Every change is written to the audit log.'
              : 'Read-only. Editing the matrix is an administrator action.'}
          </div>

          <Panel title="Modules — None · View · Edit (BR-29)" pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Screen group</th>
                    {ROLE_CODES.map((r) => (
                      <th key={r} style={{ textAlign: 'center' }}>
                        {r}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modules.map((module) => (
                    <tr key={module}>
                      <td data-label="Screen group" style={{ whiteSpace: 'nowrap' }}>
                        {MODULE_LABEL[module]}
                      </td>
                      {ROLE_CODES.map((role) => (
                        <td key={role} data-label={role} style={{ textAlign: 'center' }}>
                          <LevelMark level={MODULE_ACCESS[module][role]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ display: 'flex', gap: 20, fontSize: 12, padding: '10px 14px' }}>
              <span>✓ edit</span>
              <span>◐ view only</span>
              <span>— absent from navigation</span>
            </div>
          </Panel>

          <Panel title="Named permissions — part 01 §2.4" pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Permission</th>
                    {ROLE_CODES.map((r) => (
                      <th key={r} style={{ textAlign: 'center' }}>
                        {r}
                      </th>
                    ))}
                    <th>Movable</th>
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map((permission) => {
                    const fixed = FIXED_PERMISSIONS.includes(permission);
                    return (
                      <tr key={permission}>
                        <td data-label="Permission" className="mono" style={{ fontSize: 12 }}>
                          {permission}
                        </td>
                        {ROLE_CODES.map((role) => {
                          const has = held[role]?.has(permission);
                          return (
                            <td key={role} data-label={role} style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={!!has}
                                disabled={!editable || fixed}
                                onChange={() => toggle(role, permission)}
                              />
                            </td>
                          );
                        })}
                        <td data-label="Movable" className="muted" style={{ fontSize: 11.5 }}>
                          {fixed
                            ? 'Fixed'
                            : GRANTABLE_ANYWHERE.includes(permission)
                              ? 'Any role (BR-41)'
                              : 'Yes'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, padding: '10px 14px' }}>
              <code>pod.approve</code> is grantable, but the holder still cannot approve a proof of delivery they
              verified themselves — BR-50 is enforced by the service and by a database constraint, not by this
              screen.
            </div>
          </Panel>
        </Stack>
      )}
    </ModuleGuard>
  );
}

function LevelMark({ level }: { level: Level }) {
  const map: Record<Level, { mark: string; bg: string; ink: string }> = {
    EDIT: { mark: '✓', bg: 'var(--mint-tint)', ink: 'var(--mint)' },
    VIEW: { mark: '◐', bg: 'var(--grey-tint)', ink: 'var(--grey)' },
    NONE: { mark: '—', bg: 'transparent', ink: 'var(--color-neutral-400)' },
  };
  const { mark, bg, ink } = map[level];
  return (
    <span style={{ display: 'block', background: bg, color: ink, padding: '2px 0' }}>{mark}</span>
  );
}
