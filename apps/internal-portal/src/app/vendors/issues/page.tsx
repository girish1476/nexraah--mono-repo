'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate } from '@/lib/format';
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
  PageIntro,
  Panel,
  Stack,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import { createIssue, listIssues, listVendors, updateIssue } from '../apis';
import { Issue, VendorListRow } from '../types';

const SEVERITY_TONE: Record<Issue['severity'], Tone> = { LOW: 'grey', MEDIUM: 'flag', HIGH: 'red' };
const STATUSES: Issue['status'][] = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

/**
 * What went wrong, as somebody would say it. The stored value stays the enum
 * the fixtures and the server already use — only the reading changes.
 */
const CATEGORIES: { value: string; label: string }[] = [
  { value: 'POD_DELAY', label: 'Delivery paperwork never came back' },
  { value: 'VEHICLE_CONDITION', label: 'The vehicle was in poor condition' },
  { value: 'DRIVER_CONDUCT', label: 'A problem with the driver' },
  { value: 'PLACEMENT_FAILURE', label: 'The truck never turned up' },
  { value: 'OVERCHARGE', label: 'They asked for more than was agreed' },
  { value: 'OTHER', label: 'Something else' },
];

/** How much this matters — the word alone never says, so the sentence does. */
const SEVERITIES: { value: Issue['severity']; label: string }[] = [
  { value: 'LOW', label: 'Minor — worth having on record' },
  { value: 'MEDIUM', label: 'Needs sorting out with them' },
  { value: 'HIGH', label: 'Serious — somebody must act now' },
];

function categoryLabel(category: string): string {
  return (
    CATEGORIES.find((c) => c.value === category)?.label ??
    category.replace(/_/g, ' ').toLowerCase()
  );
}

interface IssueForm {
  vendorId: string;
  category: string;
  severity: Issue['severity'];
  tripCode: string;
  note: string;
}

const BLANK_ISSUE: IssueForm = {
  vendorId: '',
  category: 'POD_DELAY',
  severity: 'MEDIUM',
  tripCode: '',
  note: '',
};

/** Vendor issues — `/vendors/issues` (part 03 §3). */
export default function IssuesPage() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | Issue['status']>('');
  const [raising, setRaising] = useState(false);
  const [form, setForm] = useState<IssueForm>(BLANK_ISSUE);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState<VendorListRow[] | null>(null);

  const load = () => {
    setError(null);
    setRows(null);
    listIssues({ status: status || undefined })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [status]);

  const set = (patch: Partial<IssueForm>) => setForm((f) => ({ ...f, ...patch }));

  /** The vendor list is only needed once somebody actually raises something. */
  const openRaise = () => {
    setForm(BLANK_ISSUE);
    setRaising(true);
    if (!vendors) listVendors().then(setVendors).catch(() => setVendors([]));
  };

  const readyToSave = form.vendorId !== '' && form.note.trim().length > 2;

  /**
   * `code`, `raisedBy` and `raisedAt` are the server's — it knows who is
   * signed in and what time it is. A new complaint always lands OPEN.
   */
  const saveIssue = async () => {
    const vendor = (vendors ?? []).find((v) => v.id === form.vendorId);
    setSaving(true);
    try {
      const created = await createIssue({
        vendorId: form.vendorId,
        // The server derives the name from the id; sending the one on screen
        // only keeps the new row readable where it does not echo it back.
        vendorName: vendor?.legalName,
        category: form.category,
        severity: form.severity,
        tripCode: form.tripCode.trim() || null,
        note: form.note.trim(),
      });
      // A new problem is always OPEN, so it only belongs on screen while the
      // filter would have shown it — otherwise re-ask the server.
      if (!status || status === 'OPEN') {
        setRows((prev) => [
          { ...created, vendorName: created.vendorName ?? vendor?.legalName ?? '' },
          ...(prev ?? []),
        ]);
      } else {
        load();
      }
      setRaising(false);
      setForm(BLANK_ISSUE);
      toast(`Logged against ${vendor?.legalName ?? 'the transporter'} — it is open until somebody closes it`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const raiseButton = can('vendor.edit') ? (
    <button className="btn" onClick={openRaise}>
      ⚠️ Report a problem
    </button>
  ) : null;

  const columns: Column<Issue>[] = [
    { key: 'code', label: 'Issue', mono: true, render: (r) => r.code },
    { key: 'vendor', label: 'Vendor', render: (r) => r.vendorName },
    { key: 'category', label: 'What went wrong', render: (r) => categoryLabel(r.category) },
    { key: 'sev', label: 'Severity', render: (r) => <Tag tone={SEVERITY_TONE[r.severity]}>{r.severity}</Tag> },
    { key: 'trip', label: 'Related LR / trip', mono: true, render: (r) => r.tripCode ?? '—' },
    {
      key: 'raised',
      label: 'Raised',
      // A row logged from this screen may come back before the server has
      // stamped who raised it — print what there is rather than "undefined".
      render: (r) => [r.raisedBy, fmtDate(r.raisedAt)].filter(Boolean).join(' · ') || '—',
    },
    { key: 'note', label: 'Note', render: (r) => <span className="muted">{r.note}</span> },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        can('vendor.edit') ? (
          <select
            value={r.status}
            style={{
              fontFamily: 'inherit',
              fontSize: 12,
              padding: '4px 6px',
              border: '1px solid var(--color-divider)',
              borderRadius: 'var(--radius-sm)',
            }}
            onChange={async (e) => {
              try {
                const updated = await updateIssue(r.id, { status: e.target.value as Issue['status'] });
                setRows((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
                toast(`${r.code} → ${updated.status.toLowerCase()}`);
              } catch (err) {
                toast(errorMessage(err));
              }
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        ) : (
          <Tag tone={r.status === 'RESOLVED' ? 'mint' : r.status === 'OPEN' ? 'red' : 'flag'}>
            {r.status.replace(/_/g, ' ')}
          </Tag>
        ),
    },
  ];

  return (
    <ModuleGuard module="vendors">
      <PageHeader
        path="/vendors/issues"
        title="Transporter problems"
        sub="Open → In progress → Resolved"
        module="vendors"
        right={
          <>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Issue['status'] | '')}
              style={{
                fontFamily: 'inherit',
                fontSize: 13,
                padding: '7px 9px',
                border: '1px solid var(--color-divider)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            {raiseButton}
          </>
        }
      />
      <PageIntro
        what="Complaints logged against a transporter — paperwork that never came back, a vehicle in poor condition, a problem with a driver. What is on this list is what we can hold them to later."
        who="Operations, compliance and branch teams use this."
      />
      <Stack>
        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading issues" />}
        {rows && (
          <Panel pad={false}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              empty={
                <EmptyState
                  emoji={status === 'RESOLVED' ? '📭' : '🎉'}
                  title={
                    status
                      ? 'Nothing here under this filter'
                      : 'No transporter has given us trouble'
                  }
                  hint="When a transporter lets us down — delivery papers never came back, the vehicle turned up in poor condition, a driver caused a problem — report it here so it counts against their record."
                  action={raiseButton}
                />
              }
            />
          </Panel>
        )}
      </Stack>

      <Dialog
        open={raising}
        title="⚠️ Report a problem"
        body="Log what a transporter did wrong. It stays open against them until somebody sorts it out, and it counts on their record."
        confirmLabel="Report it"
        confirmDisabled={!readyToSave}
        busy={saving}
        onConfirm={saveIssue}
        onClose={() => setRaising(false)}
      >
        <Field
          label="Which transporter?"
          required
          hint={vendors === null ? 'Fetching the transporter list…' : undefined}
        >
          <select value={form.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>
            <option value="">Pick a transporter</option>
            {(vendors ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.legalName} · {v.baseCity}
              </option>
            ))}
          </select>
        </Field>
        <FormGrid>
          <Field label="What went wrong?" required>
            <select value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="How bad is it?" required>
            <select
              value={form.severity}
              onChange={(e) => set({ severity: e.target.value as Issue['severity'] })}
            >
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </FormGrid>
        <Field
          label="Which trip was it on?"
          hint="Leave this blank if it was not about one particular load."
        >
          <input
            value={form.tripCode}
            onChange={(e) => set({ tripCode: e.target.value.toUpperCase() })}
            placeholder="TRP-120881"
          />
        </Field>
        <Field
          label="What happened?"
          required
          hint="Write it as you would tell a colleague. Whoever picks this up next will only have these words to go on."
        >
          <textarea
            rows={3}
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="POD not couriered 24 days after delivery."
          />
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}
