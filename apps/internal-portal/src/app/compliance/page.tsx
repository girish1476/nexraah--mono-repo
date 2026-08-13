'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
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
} from '@/lib/ui';
import { getComplianceQueues } from '../vendors/apis';
import { ComplianceQueue } from '../vendors/types';

type Row = ComplianceQueue['rows'][number];

/**
 * Compliance desk — `/compliance` (part 03 §4).
 *
 * One queue in three segments. The trip-documents segment operates on part
 * 05's data and gates part 07's advance; it lives here because the queue is
 * one screen.
 */
export default function CompliancePage() {
  const [queues, setQueues] = useState<ComplianceQueue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getComplianceQueues().then(setQueues).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const columns: Column<Row>[] = [
    { key: 'ref', label: 'Reference', mono: true, render: (r) => r.ref },
    { key: 'subject', label: 'Subject', render: (r) => r.subject },
    { key: 'note', label: 'Waiting on', render: (r) => <span className="muted">{r.note}</span> },
    { key: 'age', label: 'Age', align: 'right', render: (r) => `${r.ageDays}d` },
    { key: 'flag', label: 'State', render: (r) => <Tag tone={r.tone as Tone}>{r.flag}</Tag> },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) => (
        <Link href={r.href} className="btn btn-secondary btn-sm">
          {r.action}
        </Link>
      ),
    },
  ];

  return (
    <ModuleGuard module="compliance">
      <PageHeader
        path="/compliance"
        title="Compliance desk"
        sub="Everything waiting on a verification decision"
        module="compliance"
      />

      <Stack gap={18}>
        {error && <ErrorState message={error} retry={load} />}
        {!queues && !error && <Loading what="Loading the queue" />}
        {(queues ?? []).map((queue) => (
          <Panel
            key={queue.key}
            title={queue.name}
            right={
              <span className="mono" style={{ fontSize: 17, color: 'var(--color-accent-700)' }}>
                {queue.rows.length}
              </span>
            }
            pad={false}
          >
            <DataTable columns={columns} rows={queue.rows} rowKey={(r) => r.ref} empty="Nothing waiting here." />
          </Panel>
        ))}
      </Stack>
    </ModuleGuard>
  );
}
