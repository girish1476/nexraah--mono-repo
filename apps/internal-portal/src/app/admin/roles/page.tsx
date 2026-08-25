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
  PERMISSION_LABEL,
  Permission,
  ROLE_CODES,
  ROLES,
  RoleCode,
} from '@/lib/permissions';
import {
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  useCan,
  useToast,
} from '@/lib/ui';
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
      toast(
        `${PERMISSION_LABEL[permission]} ${has ? 'removed from' : 'granted to'} ${ROLES[role].label} · audited`,
      );
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const modules = Object.keys(MODULE_ACCESS) as ModuleKey[];

  return (
    <ModuleGuard module="admin">
      <PageHeader path="/admin/roles" title="Who can do what" module="admin" />
      <PageIntro
        what="Which screens each job can open, and which actions each one is allowed to take."
        who="Administrators only."
      >
        Anything a role can&rsquo;t reach simply doesn&rsquo;t appear in their menu — it is never
        shown greyed out. Transporters use a completely separate application and are not on this
        table at all.
      </PageIntro>

      {error && <ErrorState message={error} retry={load} />}
      {!data && !error && <Loading what="Loading the matrix" />}

      {data && (
        <Stack>
          <div
            className="surface"
            style={{ borderLeft: '2px solid var(--color-accent)', padding: '11px 13px', fontSize: 12.5 }}
          >
            {editable
              ? 'You may grant any permission except the four marked Fixed. Release payment can never be given to a second role by anyone, including an administrator. Every change is written to the audit log.'
              : 'Read-only. Editing the matrix is an administrator action.'}
          </div>

          <Panel title="Screen groups — no access · view only · edit" pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Screen group</th>
                    {ROLE_CODES.map((r) => (
                      <th key={r} style={{ textAlign: 'center' }} title={ROLES[r].owns}>
                        {ROLES[r].label}
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
                        <td key={role} data-label={ROLES[role].label} style={{ textAlign: 'center' }}>
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

          <Panel title="Named permissions" pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Permission</th>
                    {ROLE_CODES.map((r) => (
                      <th key={r} style={{ textAlign: 'center' }} title={ROLES[r].owns}>
                        {ROLES[r].label}
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
                        <td data-label="Permission" style={{ fontSize: 12.5 }}>
                          {PERMISSION_LABEL[permission]}
                        </td>
                        {ROLE_CODES.map((role) => {
                          const has = held[role]?.has(permission);
                          return (
                            <td key={role} data-label={ROLES[role].label} style={{ textAlign: 'center' }}>
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
                              ? 'Any role'
                              : 'Yes'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, padding: '10px 14px' }}>
              Approve proof of delivery is grantable, but whoever verified a proof of delivery can&apos;t also
              approve that same one — that&apos;s enforced automatically, even though this screen doesn&apos;t stop
              you ticking the box.
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
