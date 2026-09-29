'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/apis';
import { BalancePanel } from '@/components/balance-panel';
import { POD_STATUS_LABEL, POD_TONE } from '@/lib/documents';
import { inr } from '@/lib/format';
import { downloadCsv, todayStamp } from '@/lib/export-csv';
import { activeFilterCount, emptyFilters, FilterBar, FilterField, FilterValues, matchesAny } from '@/lib/list-filters';
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
  Tone,
} from '@/lib/ui';
import { listBalanceQueue } from '../apis';
import { BalanceQueueRow } from '../types';

const FILTER_FIELDS: FilterField[] = [
  { kind: 'text', key: 'q', label: 'Search anything', placeholder: 'Trip, transporter, city…' },
  {
    kind: 'select',
    key: 'state',
    label: 'Can we pay yet?',
    allLabel: 'Either',
    options: [
      { value: 'ready', label: 'Ready to pay' },
      { value: 'held', label: 'Held for delivery proof' },
    ],
  },
  {
    kind: 'select',
    key: 'podStatus',
    label: 'Delivery proof',
    allLabel: 'Any',
    options: Object.keys(POD_STATUS_LABEL).map((v) => ({ value: v, label: POD_STATUS_LABEL[v] })),
  },
  { kind: 'text', key: 'vendor', label: 'Transporter', placeholder: 'Transporter name' },
  { kind: 'text', key: 'from', label: 'From', placeholder: 'Pick-up city' },
  { kind: 'text', key: 'to', label: 'To', placeholder: 'Delivery city' },
  { kind: 'text', key: 'ref', label: 'Trip number', placeholder: 'Trip number' },
  { kind: 'text', key: 'branchName', label: 'Branch', placeholder: 'Branch name' },
];

/** The lane is stored as one string, "Mumbai → Pune". */
function laneEnds(lane: string): [string, string] {
  const [from = '', to = ''] = lane.split('→').map((x) => x.trim());
  return [from, to];
}

/**
 * Balance queue — `/payments/balance` · `payment.release` (part 07 §2).
 * Finance lands here: it is where money is held up.
 */
export default function BalanceQueuePage() {
  const [rows, setRows] = useState<BalanceQueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BalanceQueueRow | null>(null);
  const [filters, setFilters] = useState<FilterValues>(() => emptyFilters(FILTER_FIELDS));

  const load = () => {
    setError(null);
    listBalanceQueue().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const columns: Column<BalanceQueueRow>[] = [
    { key: 'trip', label: 'Trip number', mono: true, render: (r) => r.tripCode },
    { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
    { key: 'lane', label: 'Route', render: (r) => r.lane },
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    {
      key: 'pod',
      label: 'Delivery proof',
      render: (r) => <Tag tone={POD_TONE[r.podStatus] as Tone}>{POD_STATUS_LABEL[r.podStatus] ?? r.podStatus}</Tag>,
    },
    {
      key: 'age',
      label: 'Days waiting',
      align: 'right',
      render: (r) => (
        <span style={{ color: r.podAgeDays > 40 ? 'var(--red)' : r.podAgeDays > 20 ? 'var(--flag)' : undefined }}>
          {r.podAgeDays}
        </span>
      ),
    },
    {
      key: 'penalty',
      label: 'Late penalty',
      align: 'right',
      render: (r) => <span style={{ color: r.penaltyPaise ? 'var(--red)' : undefined }}>{inr(r.penaltyPaise)}</span>,
    },
    {
      key: 'sdr',
      label: 'Shortage / damage',
      align: 'right',
      render: (r) => (
        <span style={{ color: r.sdrDeductionPaise ? 'var(--red)' : undefined }}>{inr(r.sdrDeductionPaise ?? 0)}</span>
      ),
    },
    { key: 'net', label: 'Amount to pay', align: 'right', render: (r) => inr(r.netPaise) },
    {
      key: 'state',
      label: 'Can we pay yet?',
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

  const visible = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        const [from, to] = laneEnds(r.lane);
        return (
          (!filters.state || (filters.state === 'ready' ? !r.blocked : r.blocked)) &&
          (!filters.podStatus || r.podStatus === filters.podStatus) &&
          matchesAny(filters.q, r.tripCode, r.vendorName, r.lane) &&
          matchesAny(filters.vendor, r.vendorName) &&
          matchesAny(filters.from, from) &&
          matchesAny(filters.to, to) &&
          matchesAny(filters.ref, r.tripCode) &&
          matchesAny(filters.branchName, r.branchName)
        );
      }),
    [rows, filters],
  );

  const exportRows = async () => {
    downloadCsv(
      `final-payments-${todayStamp()}.csv`,
      ['Trip', 'Transporter', 'From', 'To', 'Branch', 'Delivery proof', 'Days waiting', 'Late penalty (INR)', 'Shortage / damage (INR)', 'Amount to pay (INR)', 'Can we pay yet?', 'Conditions unmet'],
      visible.map((r) => {
        const [from, to] = laneEnds(r.lane);
        return [
          r.tripCode, r.vendorName, from, to, r.branchName, POD_STATUS_LABEL[r.podStatus] ?? r.podStatus, r.podAgeDays,
          r.penaltyPaise / 100, (r.sdrDeductionPaise ?? 0) / 100, r.netPaise / 100,
          r.blocked ? 'Held' : 'Ready to pay', r.unmetCount,
        ];
      }),
    );
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading the balance queue" />;

  const releasable = rows.filter((r) => !r.blocked);

  return (
    <ModuleGuard module="payments">
      <PageHeader
        path="/payments/balance"
        title="Final payments"
        sub="The remaining payment to the transporter, released once their proof of delivery is approved. If it isn't approved within 40 days, the balance is forfeited."
        module="payments"
      />
      <PageIntro
        what="A worklist of trips waiting on their final payment — the balance — once the transporter's proof of delivery is approved. A POD still outstanding past 40 days forfeits the balance, which shows here as a penalty."
        who="Finance releases the payment; anyone with Payments access can see the queue."
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Waiting to be paid', id: 'balance-waiting', emoji: '⏳', v: rows.length },
            { k: 'Ready to pay now', id: 'balance-ready', emoji: '✅', v: releasable.length, tone: 'mint' },
            { k: 'Held for delivery proof', id: 'balance-held-for-pod', emoji: '📸', v: rows.length - releasable.length, tone: 'red' },
            { k: 'Late-paperwork penalties', id: 'balance-late-penalties', emoji: '⚖️', v: inr(rows.reduce((a, r) => a + r.penaltyPaise, 0)), tone: 'flag' },
          ]}
        />

        <FilterBar
          fields={FILTER_FIELDS}
          values={filters}
          onChange={setFilters}
          onExport={exportRows}
          resultNote={`${visible.length} trip${visible.length === 1 ? '' : 's'} found`}
        />

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(r) => r.tripId}
            onRowClick={setSelected}
            empty={
              activeFilterCount(filters) > 0 ? (
                <EmptyState
                  title="No balance matches this search"
                  hint="Loosen one of the boxes above, or use Clear to start again."
                />
              ) : (
              <EmptyState
                title="No balances waiting"
                hint="A trip lands here once its proof of delivery is approved and the final payment falls due. An empty queue means Finance is caught up."
              />
              )
            }
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
