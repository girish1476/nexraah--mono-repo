'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { BalancePanel } from '@/components/balance-panel';
import { POD_TONE } from '@/lib/documents';
import { inr } from '@/lib/format';
import {
  Column,
  DataTable,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  StatStrip,
  Tag,
  Tone,
} from '@/lib/ui';
import { listBalanceQueue } from '../apis';
import { BalanceQueueRow } from '../types';

/**
 * Balance queue — `/payments/balance` · `payment.release` (part 07 §2).
 * Finance lands here: it is where money is held up.
 */
export default function BalanceQueuePage() {
  const [rows, setRows] = useState<BalanceQueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BalanceQueueRow | null>(null);

  const load = () => {
    setError(null);
    listBalanceQueue().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const columns: Column<BalanceQueueRow>[] = [
    { key: 'trip', label: 'Trip', mono: true, render: (r) => r.tripCode },
    { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
    { key: 'lane', label: 'Lane', render: (r) => r.lane },
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    { key: 'pod', label: 'POD', render: (r) => <Tag tone={POD_TONE[r.podStatus] as Tone}>{r.podStatus}</Tag> },
    {
      key: 'age',
      label: 'Day',
      align: 'right',
      render: (r) => (
        <span style={{ color: r.podAgeDays > 40 ? 'var(--red)' : r.podAgeDays > 20 ? 'var(--flag)' : undefined }}>
          {r.podAgeDays}
        </span>
      ),
    },
    {
      key: 'penalty',
      label: 'Penalty',
      align: 'right',
      render: (r) => <span style={{ color: r.penaltyPaise ? 'var(--red)' : undefined }}>{inr(r.penaltyPaise)}</span>,
    },
    { key: 'net', label: 'Net payable', align: 'right', render: (r) => inr(r.netPaise) },
    {
      key: 'state',
      label: 'Gate',
      render: (r) => (r.blocked ? <Tag tone="red">{r.unmetCount} unmet</Tag> : <Tag tone="mint">Releasable</Tag>),
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
  if (!rows) return <Loading what="Loading the balance queue" />;

  const releasable = rows.filter((r) => !r.blocked);

  return (
    <ModuleGuard module="payments">
      <PageHeader
        path="/payments/balance"
        title="Balance"
        sub="Gated on an approved proof of delivery. Past forty days nothing is payable (BR-10, BR-25)."
        module="payments"
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Waiting', v: rows.length },
            { k: 'Releasable now', v: releasable.length, tone: 'mint' },
            { k: 'Blocked on POD', v: rows.length - releasable.length, tone: 'red' },
            { k: 'Penalty in flight', v: inr(rows.reduce((a, r) => a + r.penaltyPaise, 0)), tone: 'flag' },
          ]}
        />

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.tripId}
            onRowClick={setSelected}
            empty="Nothing is waiting on a balance."
          />
        </Panel>

        {selected && (
          <Panel title={`${selected.tripCode} · ${selected.vendorName}`}>
            <BalancePanel
              tripId={selected.tripId}
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
