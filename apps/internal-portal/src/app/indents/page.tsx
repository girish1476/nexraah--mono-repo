'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate, inr } from '@/lib/format';
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
  Tag,
  Tone,
  useCan,
} from '@/lib/ui';
import { listIndents } from './apis';
import { IndentListRow, IndentStage } from './types';

const STAGES: IndentStage[] = ['OPEN', 'VENDOR_ASSIGNED', 'VEHICLE_PLACED', 'TRIP_CREATED', 'CANCELLED'];

const STAGE_TONE: Record<IndentStage, Tone> = {
  OPEN: 'grey',
  VENDOR_ASSIGNED: 'blue',
  VEHICLE_PLACED: 'flag',
  TRIP_CREATED: 'mint',
  CANCELLED: 'red',
};

/**
 * A load request has no transporter or truck until one is awarded, and this
 * list does not carry them — so those two boxes live on the Orders and Trips
 * lists, where the data is. Everything here narrows the rows already loaded;
 * the list is not paged.
 */
const FILTER_FIELDS: FilterField[] = [
  { kind: 'text', key: 'q', label: 'Search anything', placeholder: 'Client, city, load request…' },
  {
    kind: 'select',
    key: 'stage',
    label: 'Stage',
    allLabel: 'Any stage',
    options: STAGES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })),
  },
  { kind: 'text', key: 'clientName', label: 'Client', placeholder: 'Client name' },
  { kind: 'text', key: 'from', label: 'From', placeholder: 'Pick-up city' },
  { kind: 'text', key: 'to', label: 'To', placeholder: 'Delivery city' },
  { kind: 'text', key: 'branchName', label: 'Branch', placeholder: 'Branch name' },
];

/** The lane is stored as one string, "Mumbai → Pune". */
function laneEnds(lane: string): [string, string] {
  const [from = '', to = ''] = lane.split('→').map((x) => x.trim());
  return [from, to];
}

export default function IndentsPage() {
  const router = useRouter();
  const can = useCan();
  const [rows, setRows] = useState<IndentListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterValues>(() => emptyFilters(FILTER_FIELDS));
  const stage = filters.stage as '' | IndentStage;

  const load = () => {
    setError(null);
    setRows(null);
    listIndents({ stage: stage || undefined })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [stage]);

  const visible = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        const [from, to] = laneEnds(r.lane);
        return (
          matchesAny(filters.q, r.clientName, r.lane, r.code, r.material) &&
          matchesAny(filters.clientName, r.clientName) &&
          matchesAny(filters.from, from) &&
          matchesAny(filters.to, to) &&
          matchesAny(filters.branchName, r.branchName)
        );
      }),
    [rows, filters],
  );

  const exportRows = async () => {
    downloadCsv(
      `load-requests-${todayStamp()}.csv`,
      ['Load request', 'Client', 'From', 'To', 'Material', 'Weight (MT)', 'Truck type', 'Pick-up date', 'Client charge (INR)', 'Transporter cost (INR)', 'Quotes', 'Branch', 'Stage'],
      visible.map((r) => {
        const [from, to] = laneEnds(r.lane);
        return [
          r.code, r.clientName, from, to, r.material, r.weightTn, r.truckType, r.pickupDate?.slice(0, 10),
          r.sellRatePaise / 100, r.buyRatePaise === null ? null : r.buyRatePaise / 100, r.quoteCount, r.branchName,
          r.stage.replace(/_/g, ' '),
        ];
      }),
    );
  };

  const columns: Column<IndentListRow>[] = [
    {
      key: 'code',
      label: 'Load request',
      render: (r) => (
        <Link href={`/indents/${r.id}`} className="mono" style={{ fontSize: 12 }}>
          {r.code}
        </Link>
      ),
    },
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    {
      key: 'lane',
      label: 'Route',
      render: (r) => (
        <div>
          <div>{r.lane}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {r.material} · {r.weightTn} MT · {r.truckType}
          </div>
        </div>
      ),
    },
    { key: 'pickup', label: 'Pick up on', render: (r) => fmtDate(r.pickupDate) },
    { key: 'sell', label: 'What we charge', align: 'right', render: (r) => inr(r.sellRatePaise) },
    {
      key: 'buy',
      label: 'What the vehicle costs us',
      align: 'right',
      render: (r) => (r.buyRatePaise ? inr(r.buyRatePaise) : <span className="muted">—</span>),
    },
    { key: 'quotes', label: 'Transporter quotes', align: 'right', render: (r) => r.quoteCount },
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    {
      key: 'stage',
      label: 'How far along',
      render: (r) => (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <Tag tone={STAGE_TONE[r.stage]}>{r.stage.replace(/_/g, ' ')}</Tag>
          {r.failureCause && <Tag tone="red">{r.failureCause.replace(/_/g, ' ').toLowerCase()}</Tag>}
        </div>
      ),
    },
  ];

  return (
    <ModuleGuard module="indents">
      <PageHeader
        path="/indents"
        title="Load requests"
        sub="Demand recorded, priced and placed"
        module="indents"
        right={
          can('indent.create') && (
            <Link href="/indents/new" className="btn">
              Raise an indent
            </Link>
          )
        }
      />
      <PageIntro
        what="An indent is a shipment request — a client's freight, priced and ready to place with a transporter."
        who="Operations raises and places them; Compliance and Finance can see every one."
      />
      <Stack>
        <FilterBar
          fields={FILTER_FIELDS}
          values={filters}
          onChange={setFilters}
          onExport={exportRows}
          resultNote={rows ? `${visible.length} load request${visible.length === 1 ? '' : 's'} found` : undefined}
        />
        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading indents" />}
        {rows && (
          <Panel pad={false}>
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/indents/${r.id}`)}
              empty={
                activeFilterCount(filters) > 0 ? (
                  <EmptyState
                    title="No load request matches this search"
                    hint="Loosen one of the boxes above, or use Clear to start again."
                  />
                ) : (
                  'Nothing here.'
                )
              }
            />
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}
