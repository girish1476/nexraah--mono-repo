'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import {
  Column,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
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

/**
 * Why a state pill says what it says. Keyed on the server's `flag` string and
 * deliberately falling back to `undefined`: an unknown flag then renders as the
 * bare pill it always was rather than carrying someone else's explanation.
 */
const FLAG_REASON: Record<string, string> = {
  Blocked: 'Papers are still missing or unverified — this transporter cannot be given loads yet',
  Ready: 'Every document is verified — the file just needs activating',
  'Blocking money': "The transporter's advance cannot be released until these documents are verified",
  'No lanes priced': 'Signed, but no lane prices are on file, so nothing can be booked at an agreed rate',
  'Yours to approve': 'Lane prices are on file and waiting for your approval',
};

/** One plain line under each segment title. Server keys, so always guarded. */
const QUEUE_BLURB: Record<string, string> = {
  VENDOR_FILES:
    'New transporters whose papers you have not passed yet. Until a file is activated they cannot be given loads.',
  CLIENT_CONTRACTS:
    'Signed client rate contracts. Check that the lane prices on file match what was agreed before approving.',
  TRIP_DOCUMENTS:
    "Papers uploaded against a running trip. Verifying them releases the transporter's advance — the part-payment they get before the trip.",
};

function queueEmpty(queue: ComplianceQueue) {
  switch (queue.key) {
    case 'VENDOR_FILES':
      return (
        <EmptyState
          title="No vendor files waiting"
          hint="A transporter's file lands here once ops finish onboarding them. You check their identity checks (KYC) and documents, then activate the file so they can be given loads."
        />
      );
    case 'CLIENT_CONTRACTS':
      return (
        <EmptyState
          title="No client contracts waiting"
          hint="A rate contract appears here when a client is signed on agreed lane prices, so you can confirm the prices on file match what was signed."
        />
      );
    case 'TRIP_DOCUMENTS':
      return (
        <EmptyState
          title="No trip documents waiting"
          hint="Documents a transporter uploads against a running trip appear here. Until they are verified, that trip's advance cannot be paid."
        />
      );
    default:
      return (
        <EmptyState
          title={`Nothing waiting in ${queue.name}`}
          hint="Rows appear here as soon as something needs a verification decision."
        />
      );
  }
}

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
    { key: 'subject', label: 'What needs checking', render: (r) => r.subject },
    { key: 'note', label: 'Where it stands', render: (r) => <span className="muted">{r.note}</span> },
    {
      key: 'age',
      label: 'Waiting since',
      align: 'right',
      render: (r) => (r.ageDays === 1 ? '1 day' : `${r.ageDays} days`),
    },
    {
      key: 'flag',
      label: 'Status',
      render: (r) => (
        <Tag tone={r.tone as Tone} reason={r.flag ? FLAG_REASON[r.flag] : undefined}>
          {r.flag}
        </Tag>
      ),
    },
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
      <PageHeader path="/compliance" title="Document verification" module="compliance" />
      <PageIntro
        what="Check the vendor papers and client contracts sitting here and decide whether each one passes — a transporter cannot be given loads, and their advance cannot be paid, until you do."
        who="The compliance desk works this queue; finance can watch it."
      >
        Everything below is waiting on a verification decision. Each row opens the file where the actual
        verify or approve button lives.
      </PageIntro>

      <Stack gap={18}>
        {error && <ErrorState message={error} retry={load} />}
        {!queues && !error && <Loading what="Loading the queue" />}
        {queues && queues.length === 0 && (
          <Panel pad={false}>
            <EmptyState
              title="The compliance desk is clear"
              hint="Nothing is waiting on a verification decision right now. Vendor files, client contracts and trip documents land here the moment they need checking."
            />
          </Panel>
        )}
        {(queues ?? []).map((queue) => (
          <Panel
            key={queue.key}
            title={queue.name}
            right={
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="mono" style={{ fontSize: 17, color: 'var(--color-accent-700)' }}>
                  {queue.rows.length}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  waiting
                </span>
              </span>
            }
            pad={false}
          >
            {QUEUE_BLURB[queue.key] && (
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, padding: '11px 15px 12px' }}>
                {QUEUE_BLURB[queue.key]}
              </div>
            )}
            <DataTable
              columns={columns}
              rows={queue.rows}
              rowKey={(r) => r.ref}
              empty={queueEmpty(queue)}
            />
          </Panel>
        ))}
      </Stack>
    </ModuleGuard>
  );
}
