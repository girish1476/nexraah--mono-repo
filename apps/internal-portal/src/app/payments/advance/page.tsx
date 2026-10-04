'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
import { inr } from '@/lib/format';
import { useLiveRefresh } from '@/lib/live';
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
} from '@/lib/ui';
import { listAdvanceQueue } from '../apis';
import { AdvanceQueueRow } from '../types';

const FILTER_FIELDS: FilterField[] = [
  { kind: 'text', key: 'q', label: 'Search anything', placeholder: 'Trip, load request, transporter, city…' },
  {
    kind: 'select',
    key: 'state',
    label: 'Can we pay yet?',
    allLabel: 'Either',
    options: [
      { value: 'ready', label: 'Ready to pay' },
      { value: 'held', label: 'Held until papers are in' },
    ],
  },
  { kind: 'text', key: 'vendor', label: 'Transporter', placeholder: 'Transporter name' },
  { kind: 'text', key: 'from', label: 'From', placeholder: 'Pick-up city' },
  { kind: 'text', key: 'to', label: 'To', placeholder: 'Delivery city' },
  { kind: 'text', key: 'ref', label: 'Trip or load request number', placeholder: 'Trip or load request number' },
  { kind: 'text', key: 'branchName', label: 'Branch', placeholder: 'Branch name' },
];

/** The lane is stored as one string, "Mumbai → Pune". */
function laneEnds(lane: string): [string, string] {
  const [from = '', to = ''] = lane.split('→').map((x) => x.trim());
  return [from, to];
}

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
  const [filters, setFilters] = useState<FilterValues>(() => emptyFilters(FILTER_FIELDS));

  const load = () => {
    setError(null);
    listAdvanceQueue().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);
  useLiveRefresh(() => listAdvanceQueue().then(setRows));

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

  const visible = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        const [from, to] = laneEnds(r.lane);
        return (
          (!filters.state || (filters.state === 'ready' ? !r.blocked : r.blocked)) &&
          matchesAny(filters.q, r.tripCode, r.indentCode, r.vendorName, r.lane) &&
          matchesAny(filters.vendor, r.vendorName) &&
          matchesAny(filters.from, from) &&
          matchesAny(filters.to, to) &&
          matchesAny(filters.ref, r.tripCode, r.indentCode) &&
          matchesAny(filters.branchName, r.branchName)
        );
      }),
    [rows, filters],
  );

  const exportRows = async () => {
    downloadCsv(
      `advance-payments-${todayStamp()}.csv`,
      ['Trip', 'Load request', 'Transporter', 'From', 'To', 'Branch', 'Advance %', 'Amount (INR)', 'Can we pay yet?', 'Conditions unmet'],
      visible.map((r) => {
        const [from, to] = laneEnds(r.lane);
        return [
          r.tripCode, r.indentCode, r.vendorName, from, to, r.branchName, r.advancePct, r.grossPaise / 100,
          r.blocked ? 'Held' : 'Ready to pay', r.unmetCount,
        ];
      }),
    );
  };

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
                  title="No advance matches this search"
                  hint="Loosen one of the boxes above, or use Clear to start again."
                />
              ) : (
              <EmptyState
                title="No advances waiting"
                hint="A trip lands here once it is dispatched and eligible for an advance. An empty queue means Finance is caught up, not that something is missing."
              />
              )
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
