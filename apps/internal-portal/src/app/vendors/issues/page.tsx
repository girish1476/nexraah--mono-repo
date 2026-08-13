'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate } from '@/lib/format';
import {
  Column,
  DataTable,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import { listIssues, updateIssue } from '../apis';
import { Issue } from '../types';

const SEVERITY_TONE: Record<Issue['severity'], Tone> = { LOW: 'grey', MEDIUM: 'flag', HIGH: 'red' };
const STATUSES: Issue['status'][] = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

/** Vendor issues — `/vendors/issues` (part 03 §3). */
export default function IssuesPage() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | Issue['status']>('');

  const load = () => {
    setError(null);
    setRows(null);
    listIssues({ status: status || undefined })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [status]);

  const columns: Column<Issue>[] = [
    { key: 'code', label: 'Issue', mono: true, render: (r) => r.code },
    { key: 'vendor', label: 'Vendor', render: (r) => r.vendorName },
    { key: 'category', label: 'Category', render: (r) => r.category.replace(/_/g, ' ').toLowerCase() },
    { key: 'sev', label: 'Severity', render: (r) => <Tag tone={SEVERITY_TONE[r.severity]}>{r.severity}</Tag> },
    { key: 'trip', label: 'Related LR / trip', mono: true, render: (r) => r.tripCode ?? '—' },
    { key: 'raised', label: 'Raised', render: (r) => `${r.raisedBy} · ${fmtDate(r.raisedAt)}` },
    { key: 'note', label: 'Note', render: (r) => <span className="muted">{r.note}</span> },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        can('vendor.edit') ? (
          <select
            value={r.status}
            style={{ fontFamily: 'inherit', fontSize: 12, padding: '4px 6px', border: '1px solid var(--color-divider)' }}
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
        title="Vendor issues"
        sub="Open → In progress → Resolved"
        module="vendors"
        right={
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Issue['status'] | '')}
            style={{ fontFamily: 'inherit', fontSize: 13, padding: '7px 9px', border: '1px solid var(--color-divider)' }}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        }
      />
      <Stack>
        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading issues" />}
        {rows && (
          <Panel pad={false}>
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="No issues." />
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}
