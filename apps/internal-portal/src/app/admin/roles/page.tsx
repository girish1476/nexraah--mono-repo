'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/apis';
import {
  CUSTOM_ROLE_BASES,
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
  Dialog,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  useCan,
  useToast,
} from '@/lib/ui';
import { createRole, deleteRole, getRoleMatrix, setPermission } from './apis';
import { RoleMatrixResponse } from './types';

/** One column of either table — a built-in role, or one an administrator added. */
interface RoleColumn {
  code: string;
  label: string;
  /** The built-in role whose screens this column opens — itself, for a built-in role. */
  screens: RoleCode;
  custom: boolean;
  hint: string;
}

/**
 * Roles matrix — `/admin/roles`.
 *
 * Two tables, because BR-29 and part 01 §2.4 are two different things:
 * the module matrix (None/View/Edit per screen group) and the named
 * permissions, four of which are fixed and cannot be moved by anybody.
 *
 * An administrator can add a role. It opens the screens of the built-in role
 * it is based on — the screen groups are laid out per built-in role and are
 * not editable here — and gets its own column of named permissions to tick.
 */
export default function RolesMatrixPage() {
  const can = useCan();
  const toast = useToast();
  const editable = can('config.manage');

  const [data, setData] = useState<RoleMatrixResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [basedOn, setBasedOn] = useState<RoleCode | ''>('');
  const [removing, setRemoving] = useState<RoleColumn | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    getRoleMatrix().then(setData).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const columns = useMemo<RoleColumn[]>(
    () => [
      ...ROLE_CODES.map((code) => ({
        code,
        label: ROLES[code].label,
        screens: code,
        custom: false,
        hint: ROLES[code].owns,
      })),
      ...(data?.customRoles ?? []).map((r) => ({
        code: r.code,
        label: r.label,
        screens: r.basedOn,
        custom: true,
        hint: `Added role · opens the same screens as ${ROLES[r.basedOn]?.label ?? r.basedOn}`,
      })),
    ],
    [data],
  );

  const held = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    if (!data) return out;
    columns.forEach(({ code }) => {
      // A custom role has no seed grants — everything it holds is in `matrix`.
      const base = new Set<string>((data.grants as Record<string, Permission[]>)[code] ?? []);
      Object.entries(data.matrix[code] ?? {}).forEach(([permission, level]) => {
        if (level === 'NONE') base.delete(permission);
        else base.add(permission);
      });
      out[code] = base;
    });
    return out;
  }, [data, columns]);

  const toggle = async (role: RoleColumn, permission: Permission) => {
    const has = held[role.code]?.has(permission);
    try {
      await setPermission(role.code, permission, has ? 'NONE' : 'EDIT');
      setData((prev) =>
        prev
          ? {
              ...prev,
              matrix: {
                ...prev.matrix,
                [role.code]: { ...(prev.matrix[role.code] ?? {}), [permission]: has ? 'NONE' : 'EDIT' },
              },
            }
          : prev,
      );
      toast(`${PERMISSION_LABEL[permission]} ${has ? 'removed from' : 'granted to'} ${role.label} · audited`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const trimmedName = name.trim();
  const nameTaken = columns.some((c) => c.label.toLowerCase() === trimmedName.toLowerCase());
  const nameError =
    trimmedName && trimmedName.length < 2
      ? 'Use at least two characters'
      : nameTaken
        ? 'A role with this name already exists'
        : undefined;

  const onAdd = async () => {
    if (!basedOn || trimmedName.length < 2 || nameTaken) return;
    setBusy(true);
    try {
      setData(await createRole({ name: trimmedName, basedOn }));
      toast(`${trimmedName} added · tick what it may do below`);
      setAddOpen(false);
      setName('');
      setBasedOn('');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      setData(await deleteRole(removing.code));
      toast(`${removing.label} removed · audited`);
      setRemoving(null);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const modules = Object.keys(MODULE_ACCESS) as ModuleKey[];

  const roleHeads = (withRemove: boolean) =>
    columns.map((c) => (
      <th key={c.code} style={{ textAlign: 'center' }} title={c.hint}>
        {c.label}
        {c.custom && withRemove && editable && (
          <div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 4 }}
              aria-label={`Remove role ${c.label}`}
              onClick={() => setRemoving(c)}
            >
              Remove
            </button>
          </div>
        )}
      </th>
    ));

  return (
    <ModuleGuard module="admin">
      <PageHeader
        path="/admin/roles"
        title="Access control"
        module="admin"
        right={
          editable &&
          data && (
            <button className="btn" onClick={() => setAddOpen(true)}>
              + Add a role
            </button>
          )
        }
      />
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
              ? 'You may grant any permission except the four marked Fixed. Release payment can never be given to a second role by anyone, including an administrator. Need a job that none of these fit? Add a role, then tick what it may do. Every change is written to the audit log.'
              : 'Read-only. Editing the matrix is an administrator action.'}
          </div>

          <Panel title="Screen groups — no access · view only · edit" pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Screen group</th>
                    {roleHeads(false)}
                  </tr>
                </thead>
                <tbody>
                  {modules.map((module) => (
                    <tr key={module}>
                      <td data-label="Screen group" style={{ whiteSpace: 'nowrap' }}>
                        {MODULE_LABEL[module]}
                      </td>
                      {columns.map((c) => (
                        <td key={c.code} data-label={c.label} style={{ textAlign: 'center' }}>
                          <LevelMark level={MODULE_ACCESS[module][c.screens] ?? 'NONE'} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12, padding: '10px 14px' }}>
              <span>✓ edit</span>
              <span>◐ view only</span>
              <span>— absent from navigation</span>
              {columns.some((c) => c.custom) && (
                <span>An added role opens the same screens as the role it was based on.</span>
              )}
            </div>
          </Panel>

          <Panel title="Named permissions" pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Permission</th>
                    {roleHeads(true)}
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
                        {columns.map((c) => (
                          <td key={c.code} data-label={c.label} style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              aria-label={`${PERMISSION_LABEL[permission]} for ${c.label}`}
                              checked={!!held[c.code]?.has(permission)}
                              disabled={!editable || fixed}
                              onChange={() => toggle(c, permission)}
                            />
                          </td>
                        ))}
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

      <Dialog
        open={addOpen}
        title="Add a role"
        body="The new role opens the same screens as the role you base it on, and starts with that role's permissions (except the fixed ones). Tick or untick its column under Named permissions to set exactly what it may do, then give it to people from Allowed emails."
        confirmLabel="Add role"
        confirmDisabled={!basedOn || trimmedName.length < 2 || nameTaken}
        busy={busy}
        onConfirm={onAdd}
        onClose={() => setAddOpen(false)}
      >
        <Field label="Role name" required error={nameError}>
          <input
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Accounts assistant"
            autoFocus
          />
        </Field>
        <Field label="Based on" required hint="Decides which screens the role can open.">
          <select value={basedOn} onChange={(e) => setBasedOn(e.target.value as RoleCode | '')}>
            <option value="">Select a role</option>
            {CUSTOM_ROLE_BASES.map((c) => (
              <option key={c} value={c}>
                {ROLES[c].label}
              </option>
            ))}
          </select>
        </Field>
      </Dialog>

      <Dialog
        open={!!removing}
        title={`Remove ${removing?.label ?? 'role'}`}
        body="The role and everything ticked for it are removed. This is refused while anyone on Allowed emails still signs in with it — move them to another role first."
        confirmLabel="Remove role"
        busy={busy}
        onConfirm={onRemove}
        onClose={() => setRemoving(null)}
      />
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
