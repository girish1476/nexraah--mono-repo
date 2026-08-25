'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
import { inr } from '@/lib/format';
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
  StatStrip,
  Tag,
} from '@/lib/ui';
import { listAdvanceQueue } from '../apis';
import { AdvanceQueueRow } from '../types';

/**
 * Advance queue — `/payments/advance` · `payment.release` (part 07 §1).
 *
 * Each row shows what is releasable, what is blocked and how many conditions
 * are unmet. Selecting a row opens the same gate component the indent and
 * trip screens use.
 */
export default function AdvanceQueuePage() {
  const [rows, setRows] = useState<AdvanceQueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdvanceQueueRow | null>(null);

  const load = () => {
    setError(null);
    listAdvanceQueue().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const columns: Column<AdvanceQueueRow>[] = [
    { key: 'trip', label: 'Trip number', mono: true, render: (r) => r.tripCode },
    { key: 'indent', label: 'Load request', mono: true, render: (r) => r.indentCode },
    { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
    { key: 'lane', label: 'Route', render: (r) => r.lane },
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    { key: 'pct', label: 'Advance amount', align: 'right', render: (r) => `${r.advancePct}%` },
    { key: 'gross', label: 'Amount', align: 'right', render: (r) => inr(r.grossPaise) },
    {
      key: 'state',
      label: 'Can we pay yet?',
      render: (r) =>
        r.blocked ? (
          <Tag tone="red">{r.unmetCount} unmet</Tag>
        ) : (
          <Tag tone="mint">Releasable</Tag>
        ),
    },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) => (
        <button className="btn btn-secondary btn-sm" onClick={() => setSelected(r)}>
          Open
        </button>
      ),
    },
  ];

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading the advance queue" />;

  const releasable = rows.filter((r) => !r.blocked);

  return (
    <ModuleGuard module="payments">
      <PageHeader
        path="/payments/advance"
        title="Advance payments"
        sub="Money released to the transporter before delivery is complete, once their paperwork is verified. Anything still missing is listed below."
        module="payments"
      />
      <PageIntro
        what="A worklist of trips whose transporter is due an advance — see which are ready to release now, which are still blocked, and open one to check exactly what's missing."
        who="Finance releases the payment; anyone with Payments access can see the queue."
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Waiting to be paid', id: 'advance-waiting', emoji: '⏳', v: rows.length },
            { k: 'Ready to pay now', id: 'advance-ready', emoji: '✅', v: releasable.length, tone: 'mint' },
            { k: 'Held until papers are in', id: 'advance-held', emoji: '🔒', v: rows.length - releasable.length, tone: 'red' },
            { k: 'Money ready to go out', id: 'advance-ready-value', emoji: '💰', v: inr(releasable.reduce((a, r) => a + r.grossPaise, 0)), tone: 'mint' },
          ]}
        />

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.tripId}
            onRowClick={setSelected}
            empty={
              <EmptyState
                title="No advances waiting"
                hint="A trip lands here once it is dispatched and eligible for an advance. An empty queue means Finance is caught up, not that something is missing."
              />
            }
          />
        </Panel>

        {selected && (
          <Panel title={`${selected.tripCode} · ${selected.vendorName}`}>
            <AdvancePanel
              indentId={selected.indentId}
              onReleased={() => {
                setSelected(null);
                load();
              }}
            />
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}
