'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { errorMessage } from '@/apis';
import { peopleStoreEnabled, realEmailEnabled } from '@/lib/auth';
import { downloadCsv, todayStamp } from '@/lib/export-csv';
import { fmtDate } from '@/lib/format';
import { ROLE_CODES, ROLES } from '@/lib/permissions';
import { sessionAtom } from '@/store/atoms';
import {
  Column,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  StatStrip,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { listBranches } from '../branches/apis';
import { Branch } from '../branches/types';
import { getRoleMatrix } from '../roles/apis';
import { CustomRole } from '../roles/types';
import { AllowedEmail, MOBILE_RE, allowEmail, listAllowedEmails, updateAllowedEmail } from './apis';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Only what a mobile number can contain — letters never reach the box. */
const mobileTyped = (raw: string) => raw.replace(/[^\d+\s-]/g, '');

type StatusFilter = '' | 'ACTIVE' | 'DISABLED' | 'NO_MOBILE';

/** The person form — the same boxes for adding someone and for editing them. */
interface PersonForm {
  email: string;
  name: string;
  phone: string;
  role: string;
  branchId: string;
}

const BLANK: PersonForm = { email: '', name: '', phone: '', role: '', branchId: '' };

/**
 * People and access — `/admin/users` · `config.manage`.
 *
 * The console has no passwords: people sign in with their email and a
 * one-time code sent to it. This list is who may do that, as which role, and
 * for which branch. Adding someone lets them sign in straight away; changing
 * their role applies on their next click; switching them off stops their
 * sign-in without losing the record of what they did.
 *
 * The list is read-only on its face and every change goes through a dialog
 * (owner's direction, 2026-10-08). A role used to be a dropdown in the row,
 * which changed somebody's access the moment it was touched — one slip of the
 * scroll wheel. A change to who can do what is now something an administrator
 * opens, looks at and saves.
 */
export default function AllowedEmailsPage() {
  const can = useCan();
  const toast = useToast();
  const session = useAtomValue(sessionAtom);
  const editable = can('config.manage');

  const [rows, setRows] = useState<AllowedEmail[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Finding people.
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');

  // Adding (`adding`), editing (`editing`) and switching off (`switchingOff`) — one dialog each.
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AllowedEmail | null>(null);
  const [switchingOff, setSwitchingOff] = useState<AllowedEmail | null>(null);
  const [form, setForm] = useState<PersonForm>(BLANK);

  // Built-in roles, then any added from Access control.
  const roleOptions = [
    ...ROLE_CODES.map((code) => ({ code: code as string, label: ROLES[code].label })),
    ...customRoles.map((r) => ({ code: r.code, label: r.label })),
  ];
  const roleLabel = (code: string) => roleOptions.find((o) => o.code === code)?.label ?? code;

  const load = () => {
    setError(null);
    listAllowedEmails().then(setRows).catch((e) => setError(errorMessage(e)));
  };

  // Real codes are emailed, but this list is not shared with the server that
  // sends them: adding someone here would not let them in, so the screen says so.
  const [browserOnly, setBrowserOnly] = useState(false);
  useEffect(() => {
    void Promise.all([realEmailEnabled(), peopleStoreEnabled()]).then(([real, store]) => setBrowserOnly(real && !store));
  }, []);

  useEffect(() => {
    load();
    listBranches().then(setBranches).catch(() => setBranches([]));
    getRoleMatrix()
      .then((m) => setCustomRoles(m.customRoles ?? []))
      .catch(() => setCustomRoles([]));
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!q || [r.name, r.email, r.phone ?? ''].some((v) => v.toLowerCase().includes(q))) &&
        (!roleFilter || r.role === roleFilter) &&
        (!branchFilter || (branchFilter === 'ALL' ? !r.branch : r.branch?.id === branchFilter)) &&
        (!statusFilter ||
          (statusFilter === 'NO_MOBILE' ? !r.phone : statusFilter === 'DISABLED' ? r.status === 'DISABLED' : r.status !== 'DISABLED')),
    );
  }, [rows, search, roleFilter, branchFilter, statusFilter]);

  const filtered = !!(search.trim() || roleFilter || branchFilter || statusFilter);
  const clearFilters = () => {
    setSearch('');
    setRoleFilter('');
    setBranchFilter('');
    setStatusFilter('');
  };

  /* ---- the form ---------------------------------------------------------- */

  const openAdd = () => {
    setForm(BLANK);
    setAdding(true);
  };

  const openEdit = (row: AllowedEmail) => {
    setForm({ email: row.email, name: row.name, phone: row.phone ?? '', role: row.role, branchId: row.branch?.id ?? '' });
    setEditing(row);
  };

  const isSelf = (row: AllowedEmail | null) => !!row && !!session && row.id === session.userId;

  const emailProblem = adding && form.email.trim() && !EMAIL_RE.test(form.email.trim()) ? 'Enter a valid email address' : undefined;
  // Required for a new person. Somebody added before the number was asked for
  // may be saved without one, but a number that is typed has to be a real one.
  const phoneProblem =
    form.phone.trim() && !MOBILE_RE.test(form.phone.trim())
      ? 'Enter a 10-digit mobile number, starting with 6, 7, 8 or 9'
      : undefined;
  const formInvalid =
    !form.role ||
    !!phoneProblem ||
    (adding && (!EMAIL_RE.test(form.email.trim()) || !form.phone.trim())) ||
    (!!editing && !form.name.trim());

  const save = async () => {
    if (formInvalid) return;
    setBusy(true);
    try {
      if (editing) {
        // Only what changed is sent — an untouched role is not "set" again.
        const patch: Parameters<typeof updateAllowedEmail>[1] = {};
        if (form.name.trim() !== editing.name) patch.name = form.name.trim();
        if (form.phone.trim() && form.phone.trim() !== (editing.phone ?? '')) patch.phone = form.phone.trim();
        if (form.role !== editing.role) patch.role = form.role;
        if (form.branchId !== (editing.branch?.id ?? '')) patch.branchId = form.branchId || null;
        if (Object.keys(patch).length > 0) {
          const updated = await updateAllowedEmail(editing.id, patch);
          setRows((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
          toast(`${updated.name} updated`);
        }
        setEditing(null);
      } else {
        const added = await allowEmail({
          email: form.email.trim().toLowerCase(),
          role: form.role,
          phone: form.phone.trim(),
          name: form.name.trim() || undefined,
          branchId: form.branchId || undefined,
        });
        setRows((prev) => [added, ...(prev ?? [])]);
        toast(`${added.email} can now sign in as ${roleLabel(added.role)}`);
        setAdding(false);
      }
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const setAccess = async (row: AllowedEmail, status: 'ACTIVE' | 'DISABLED') => {
    setBusy(true);
    try {
      const updated = await updateAllowedEmail(row.id, { status });
      setRows((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
      toast(status === 'DISABLED' ? `${row.email} can no longer sign in` : `${row.email} can sign in again`);
      setSwitchingOff(null);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () =>
    downloadCsv(
      `people-${todayStamp()}.csv`,
      ['Name', 'Email', 'Mobile', 'Role', 'Sees', 'Sign-in', 'Added on'],
      shown.map((r) => [
        r.name,
        r.email,
        r.phone ?? '',
        roleLabel(r.role),
        r.branch ? `Only ${r.branch.name}` : 'Every branch',
        r.status === 'DISABLED' ? 'Switched off' : 'Allowed',
        fmtDate(r.createdAt),
      ]),
    );

  /* ---- the list ---------------------------------------------------------- */

  const columns: Column<AllowedEmail>[] = [
    {
      key: 'person',
      label: 'Person',
      primary: true,
      render: (r) => (
        <span>
          {r.name} {isSelf(r) && <Tag tone="blue">You</Tag>}
        </span>
      ),
      sub: (r) => r.email,
    },
    {
      key: 'phone',
      label: 'Mobile',
      mono: true,
      render: (r) => r.phone ?? <Tag tone="flag">Not added</Tag>,
    },
    { key: 'role', label: 'Role', render: (r) => roleLabel(r.role) },
    { key: 'branch', label: 'Sees', render: (r) => (r.branch ? `Only ${r.branch.name}` : 'Every branch') },
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
    { key: 'added', label: 'Added on', render: (r) => fmtDate(r.createdAt) },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) =>
        editable && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => openEdit(r)}>
              Edit
            </button>
            {r.status === 'DISABLED' ? (
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setAccess(r, 'ACTIVE')}>
                Switch on
              </button>
            ) : (
              // Nobody switches themselves off — it cannot be undone from inside the console.
              !isSelf(r) && (
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setSwitchingOff(r)}>
                  Switch off
                </button>
              )
            )}
          </div>
        ),
    },
  ];

  const all = rows ?? [];
  const switchedOff = all.filter((r) => r.status === 'DISABLED').length;
  const noMobile = all.filter((r) => !r.phone).length;
  const admins = all.filter((r) => r.role === 'ADMIN' && r.status !== 'DISABLED').length;

  return (
    <ModuleGuard module="admin">
      <PageHeader
        path="/admin/users"
        title="Allowed emails"
        sub="Who can sign in, as which role, and for which branch. People sign in with their email and a one-time code sent to it — there are no passwords."
        module="admin"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {rows && rows.length > 0 && (
              <button className="btn btn-secondary" onClick={download}>
                Download list
              </button>
            )}
            {editable && (
              <button className="btn" onClick={openAdd}>
                Allow an email
              </button>
            )}
          </div>
        }
      />

      {browserOnly && (
        <div
          className="surface"
          role="note"
          style={{ borderLeft: '2px solid var(--color-accent)', padding: '11px 13px', fontSize: 12.5, marginBottom: 12 }}
        >
          Sign-in codes are emailed only to the people on the deployment’s own list. Someone added here is kept in this
          browser and will not get a code until the shared list of people is set up — ask whoever looks after the
          hosting.
        </div>
      )}

      {error && <ErrorState message={error} retry={load} />}
      {!rows && !error && <Loading what="Loading the people who can sign in" />}
      {rows && (
        <Stack>
          <StatStrip
            stats={[
              { k: 'People', id: 'people-total', emoji: '👥', v: all.length },
              { k: 'Can sign in', id: 'people-active', emoji: '✅', v: all.length - switchedOff },
              {
                k: 'Switched off',
                id: 'people-off',
                emoji: '⛔',
                v: switchedOff,
              },
              {
                k: 'Administrators',
                id: 'people-admins',
                emoji: '🎛️',
                v: admins,
                // One administrator is one lost phone away from nobody being able to manage access.
                tone: admins < 2 ? 'flag' : undefined,
                note: admins < 2 ? 'Keep at least two' : undefined,
              },
              {
                k: 'No mobile number',
                id: 'people-no-mobile',
                emoji: '📵',
                v: noMobile,
                tone: noMobile ? 'flag' : undefined,
              },
            ]}
          />

          <div className="surface" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 14px' }}>
            <Field label="Find a person">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, email or mobile"
                style={{ minWidth: 220 }}
              />
            </Field>
            <Field label="Role">
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="">Every role</option>
                {roleOptions.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sees">
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="">Any</option>
                <option value="ALL">Every branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    Only {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sign-in">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="">Everyone</option>
                <option value="ACTIVE">Can sign in</option>
                <option value="DISABLED">Switched off</option>
                <option value="NO_MOBILE">No mobile number</option>
              </select>
            </Field>
            {filtered && (
              <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
                Clear
              </button>
            )}
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
              {filtered ? `${shown.length} of ${all.length} people` : `${all.length} people`}
            </span>
          </div>

          <Panel pad={false}>
            <DataTable
              columns={columns}
              rows={shown}
              rowKey={(r) => r.id}
              empty={
                filtered ? (
                  <EmptyState title="Nobody matches" hint="Clear the search and filters to see everyone." />
                ) : (
                  'Nobody is allowed to sign in yet. Add the first email.'
                )
              }
            />
          </Panel>
        </Stack>
      )}

      <Dialog
        open={adding || !!editing}
        title={editing ? `Edit ${editing.name}` : 'Allow an email to sign in'}
        body={
          editing
            ? 'A change of role or branch applies the next time they click anything.'
            : 'They can sign in straight away: they type this email on the sign-in screen and get a one-time code by email.'
        }
        confirmLabel={editing ? 'Save changes' : 'Allow'}
        confirmDisabled={formInvalid}
        busy={busy}
        onConfirm={save}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      >
        <FormGrid>
          <Field
            label="Email"
            required
            error={emailProblem}
            hint={editing ? 'The email is how they sign in and cannot be changed. Add a new person instead.' : undefined}
          >
            <input
              type="email"
              value={form.email}
              disabled={!!editing}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="name@company.com"
              autoFocus={!editing}
            />
          </Field>
          <Field
            label="Mobile number"
            required={!editing}
            hint="Ten digits. Shown beside their name on the steps they do."
            error={phoneProblem}
          >
            <input
              type="tel"
              inputMode="numeric"
              maxLength={16}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: mobileTyped(e.target.value) })}
              placeholder="e.g. 98480 12345"
            />
          </Field>
          <Field
            label="Name"
            required={!!editing}
            // Worded without the words "email" or "mobile": the sign-in test finds
            // each box by its label's text, and a hint that names another box is found too.
            hint={editing ? 'Shown on the records they create.' : 'Optional — defaults to the part before the @.'}
          >
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Priya Sharma" />
          </Field>
          <Field
            label="Role"
            required
            hint={
              isSelf(editing)
                ? 'You cannot change your own role. Ask another administrator.'
                : 'What they can see and do once signed in.'
            }
          >
            <select value={form.role} disabled={isSelf(editing)} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="">Select a role</option>
              {roleOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Branch" hint="Leave as every branch unless they should see only one.">
            <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
              <option value="">Every branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  Only {b.name}
                </option>
              ))}
            </select>
          </Field>
        </FormGrid>
      </Dialog>

      <Dialog
        open={!!switchingOff}
        title={`Switch off ${switchingOff?.name ?? ''}`}
        body="They will not be able to sign in, and are signed out the next time they click anything. Everything they have done stays on record under their name. You can switch them back on at any time."
        facts={
          switchingOff
            ? [
                ['Email', switchingOff.email],
                ['Role', roleLabel(switchingOff.role)],
              ]
            : []
        }
        confirmLabel="Switch off"
        busy={busy}
        onConfirm={() => switchingOff && setAccess(switchingOff, 'DISABLED')}
        onClose={() => setSwitchingOff(null)}
      />
    </ModuleGuard>
  );
}
