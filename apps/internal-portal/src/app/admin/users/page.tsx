'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { ROLE_CODES, ROLES } from '@/lib/permissions';
import {
  Column,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { listBranches } from '../branches/apis';
import { Branch } from '../branches/types';
import { getRoleMatrix } from '../roles/apis';
import { CustomRole } from '../roles/types';
import { AllowedEmail, allowEmail, listAllowedEmails, updateAllowedEmail } from './apis';

/**
 * Allowed emails — `/admin/users` · `config.manage`.
 *
 * The console has no passwords: people sign in with their email and a
 * one-time code sent to it. This list is who may do that. Add an email with a
 * role and that person can sign in straight away, as that role — nothing to
 * send them, no account to set up. Change the role here and it applies on
 * their next click; switch an email off and their sign-in stops working.
 */
export default function AllowedEmailsPage() {
  const can = useCan();
  const toast = useToast();
  const editable = can('config.manage');

  const [rows, setRows] = useState<AllowedEmail[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  // Built-in roles, then any added from Access control.
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const roleOptions = [
    ...ROLE_CODES.map((code) => ({ code: code as string, label: ROLES[code].label })),
    ...customRoles.map((r) => ({ code: r.code, label: r.label })),
  ];
  const roleLabel = (code: string) => roleOptions.find((o) => o.code === code)?.label ?? code;
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    listAllowedEmails().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(() => {
    load();
    listBranches().then(setBranches).catch(() => setBranches([]));
    getRoleMatrix()
      .then((m) => setCustomRoles(m.customRoles ?? []))
      .catch(() => setCustomRoles([]));
  }, []);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const onAllow = async () => {
    if (!emailValid || !role) return;
    setBusy(true);
    try {
      const added = await allowEmail({
        email: email.trim().toLowerCase(),
        role,
        name: name.trim() || undefined,
        branchId: branchId || undefined,
      });
      toast(`${added.email} can now sign in as ${roleLabel(added.role)}`);
      setRows((prev) => [added, ...(prev ?? [])]);
      setOpen(false);
      setEmail('');
      setRole('');
      setName('');
      setBranchId('');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const patchRow = async (row: AllowedEmail, patch: Parameters<typeof updateAllowedEmail>[1], done?: string) => {
    setSaving(row.id);
    try {
      const updated = await updateAllowedEmail(row.id, patch);
      setRows((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
      if (done) toast(done);
    } catch (e) {
      toast(errorMessage(e));
      load();
    } finally {
      setSaving(null);
    }
  };

  const columns: Column<AllowedEmail>[] = [
    {
      key: 'email',
      label: 'Email',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.email}</div>
          <div className="muted" style={{ fontSize: 12 }}>{r.name}</div>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (r) =>
        editable ? (
          <select
            value={r.role}
            disabled={saving === r.id}
            aria-label={`Role for ${r.email}`}
            onChange={(e) => patchRow(r, { role: e.target.value }, `${r.email} is now ${roleLabel(e.target.value)}`)}
          >
            {roleOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          roleLabel(r.role)
        ),
    },
    {
      key: 'branch',
      label: 'Sees',
      render: (r) =>
        editable ? (
          <select
            value={r.branch?.id ?? ''}
            disabled={saving === r.id}
            aria-label={`Branch for ${r.email}`}
            onChange={(e) => patchRow(r, { branchId: e.target.value || null })}
          >
            <option value="">Every branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                Only {b.name}
              </option>
            ))}
          </select>
        ) : r.branch ? (
          `Only ${r.branch.name}`
        ) : (
          'Every branch'
        ),
    },
    {
      key: 'status',
      label: 'Sign-in',
      render: (r) =>
        r.status === 'DISABLED' ? (
          <Tag tone="red">Switched off</Tag>
        ) : r.canSignIn ? (
          <Tag tone="mint">Allowed</Tag>
        ) : (
          <Tag tone="flag">Login not created</Tag>
        ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) =>
        editable && (
          <button
            className="btn btn-secondary btn-sm"
            disabled={saving === r.id}
            onClick={() =>
              patchRow(
                r,
                { status: r.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' },
                r.status === 'DISABLED' ? `${r.email} can sign in again` : `${r.email} can no longer sign in`,
              )
            }
          >
            {r.status === 'DISABLED' ? 'Switch on' : 'Switch off'}
          </button>
        ),
    },
  ];

  return (
    <ModuleGuard module="admin">
      <PageHeader
        path="/admin/users"
        title="Allowed emails"
        sub="Who can sign in, and as which role. People sign in with their email and a one-time code sent to it — there are no passwords."
        module="admin"
        right={
          editable && (
            <button className="btn" onClick={() => setOpen(true)}>
              Allow an email
            </button>
          )
        }
      />

      {error && <ErrorState message={error} retry={load} />}
      {!rows && !error && <Loading what="Loading allowed emails" />}
      {rows && (
        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty="Nobody is allowed to sign in yet. Add the first email."
          />
        </Panel>
      )}

      <Dialog
        open={open}
        title="Allow an email to sign in"
        body="They can sign in straight away: they type this email on the sign-in screen and get a one-time code by email."
        confirmLabel="Allow"
        confirmDisabled={!emailValid || !role}
        busy={busy}
        onConfirm={onAllow}
        onClose={() => setOpen(false)}
      >
        <Field label="Email" required error={email.trim() && !emailValid ? 'Enter a valid email address' : undefined}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            autoFocus
          />
        </Field>
        <Field label="Role" required hint="What they can see and do once signed in. You can change it later.">
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Select a role</option>
            {roleOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name" hint="Optional — shown on records they create. Defaults to the part before the @.">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" />
        </Field>
        <Field label="Branch" hint="Leave as every branch unless they should see only one.">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Every branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                Only {b.name}
              </option>
            ))}
          </select>
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}
