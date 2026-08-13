'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
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
    { key: 'trip', label: 'Trip', mono: true, render: (r) => r.tripCode },
    { key: 'indent', label: 'Indent', mono: true, render: (r) => r.indentCode },
    { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
    { key: 'lane', label: 'Lane', render: (r) => r.lane },
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    { key: 'pct', label: 'Advance', align: 'right', render: (r) => `${r.advancePct}%` },
    { key: 'gross', label: 'Amount', align: 'right', render: (r) => inr(r.grossPaise) },
    {
      key: 'state',
      label: 'Gate',
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
        title="Advance"
        sub="Gated on document verification. The blocked panel names what is missing (BR-07, BR-58)."
        module="payments"
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Waiting', v: rows.length },
            { k: 'Releasable now', v: releasable.length, tone: 'mint' },
            { k: 'Blocked', v: rows.length - releasable.length, tone: 'red' },
            { k: 'Releasable value', v: inr(releasable.reduce((a, r) => a + r.grossPaise, 0)), tone: 'mint' },
          ]}
        />

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.tripId}
            onRowClick={setSelected}
            empty="Nothing is waiting on an advance."
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
