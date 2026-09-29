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
} from '@/lib/ui';
import { listTrips } from './apis';
import { POD_STATUS_LABEL, POD_TONE } from '@/lib/documents';
import { PodStatus, TripListRow, TripStage } from './types';

const STAGES: TripStage[] = ['OPEN', 'IN_TRANSIT', 'DELIVERED', 'CLOSED'];
const POD_STATUSES: PodStatus[] = ['PENDING', 'ATTACHED', 'RECEIVED', 'VERIFIED', 'APPROVED', 'WAIVED', 'FORFEITED'];

/**
 * The search boxes. `q`, stage and delivery proof are asked of the server (it
 * already searched on those); the rest narrow the rows that come back, which is
 * the whole result — this list is not paged.
 */
const FILTER_FIELDS: FilterField[] = [
  { kind: 'text', key: 'q', label: 'Search anything', placeholder: 'LR, trip, load request, truck…' },
  {
    kind: 'select',
    key: 'stage',
    label: 'Stage',
    allLabel: 'Any stage',
    options: STAGES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })),
  },
  { kind: 'select', key: 'podStatus', label: 'Delivery proof', allLabel: 'Any', options: POD_STATUSES.map((s) => ({ value: s, label: POD_STATUS_LABEL[s] ?? s })) },
  { kind: 'text', key: 'vendor', label: 'Transporter', placeholder: 'Transporter name' },
  { kind: 'text', key: 'clientName', label: 'Client', placeholder: 'Client name' },
  { kind: 'text', key: 'from', label: 'From', placeholder: 'Pick-up city' },
  { kind: 'text', key: 'to', label: 'To', placeholder: 'Delivery city' },
  { kind: 'text', key: 'truck', label: 'Truck number', placeholder: 'e.g. MH12AB1234' },
  { kind: 'text', key: 'ref', label: 'Load request or trip number', placeholder: 'Load request, trip or LR number' },
  { kind: 'text', key: 'branchName', label: 'Branch', placeholder: 'Branch name' },
];

/** The lane is stored as one string, "Mumbai → Pune". */
function laneEnds(lane: string): [string, string] {
  const [from = '', to = ''] = lane.split('→').map((x) => x.trim());
  return [from, to];
}

/** Trip search — `/trips` (part 05 §1). Search spans indents and trips together. */
export default function TripsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<TripListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterValues>(() => emptyFilters(FILTER_FIELDS));
  const { q, stage, podStatus } = filters;

  const load = () => {
    setError(null);
    setRows(null);
    listTrips({ q: q || undefined, stage: stage || undefined, pod_status: podStatus || undefined })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [q, stage, podStatus]);

  const visible = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        const [from, to] = laneEnds(r.lane);
        return (
          matchesAny(filters.vendor, r.vendorName) &&
          matchesAny(filters.clientName, r.clientName) &&
          matchesAny(filters.from, from) &&
          matchesAny(filters.to, to) &&
          matchesAny(filters.truck, r.vehicleNo) &&
          matchesAny(filters.ref, r.code, r.lrCode, r.indentCode) &&
          matchesAny(filters.branchName, r.branchName)
        );
      }),
    [rows, filters],
  );

  const exportRows = async () => {
    downloadCsv(
      `trips-${todayStamp()}.csv`,
      ['Trip', 'LR', 'Load request', 'Client', 'From', 'To', 'Transporter', 'Truck number', 'Branch', 'Stage', 'Delivery proof', 'Delivered on', 'Transporter cost (INR)', 'Client charge (INR)'],
      visible.map((r) => {
        const [from, to] = laneEnds(r.lane);
        return [
          r.code, r.lrCode, r.indentCode, r.clientName, from, to, r.vendorName, r.vehicleNo, r.branchName,
          r.stage.replace(/_/g, ' '), POD_STATUS_LABEL[r.podStatus] ?? r.podStatus, r.deliveredAt?.slice(0, 10),
          r.buyRatePaise / 100, r.sellRatePaise / 100,
        ];
      }),
    );
  };

  const columns: Column<TripListRow>[] = [
    {
      key: 'code',
      label: 'Trip number',
      render: (r) => (
        <div>
          <Link href={`/trips/${r.id}`} className="mono" style={{ fontSize: 12 }}>
            {r.code}
          </Link>
          <div className="muted mono" style={{ fontSize: 11 }}>
            {r.lrCode ?? 'no LR'} · {r.indentCode}
          </div>
        </div>
      ),
    },
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
    { key: 'lane', label: 'Route', render: (r) => r.lane },
    { key: 'vehicle', label: 'Vehicle', mono: true, render: (r) => r.vehicleNo },
    { key: 'delivered', label: 'Delivered', render: (r) => fmtDate(r.deliveredAt) },
    { key: 'buy', label: 'Transporter cost', align: 'right', render: (r) => inr(r.buyRatePaise) },
    { key: 'stage', label: 'How far along', render: (r) => <Tag tone="grey">{r.stage.replace(/_/g, ' ')}</Tag> },
    {
      key: 'pod',
      label: 'Delivery proof',
      render: (r) => <Tag tone={POD_TONE[r.podStatus] as Tone}>{POD_STATUS_LABEL[r.podStatus] ?? r.podStatus}</Tag>,
    },
  ];

  return (
    <ModuleGuard module="trips">
      <PageHeader path="/trips" title="Trips on the road" sub="The operational and financial record of a consignment in motion" module="trips" />
      <PageIntro
        what="Search every trip — on the road or already delivered — by LR, trip, indent, truck, transporter, client or branch, and see its stage and POD status at a glance."
        who="Operations lives in this list day to day; everyone else can look a trip up here too."
      />
      <Stack>
        <FilterBar
          fields={FILTER_FIELDS}
          values={filters}
          onChange={setFilters}
          onExport={exportRows}
          resultNote={rows ? `${visible.length} trip${visible.length === 1 ? '' : 's'} found` : undefined}
        />
        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading trips" />}
        {rows && (
          <Panel pad={false}>
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/trips/${r.id}`)}
              empty={
                <EmptyState
                  title={activeFilterCount(filters) > 0 ? 'No trip matches this search' : 'No trips yet'}
                  hint={
                    activeFilterCount(filters) > 0
                      ? 'Loosen one of the boxes above, or use Clear to start again.'
                      : 'A trip is created once a vehicle is placed against an indent. Place one there and it will show up here.'
                  }
                  action={
                    activeFilterCount(filters) === 0 ? (
                      <Link href="/indents" className="btn">
                        Go to indents
                      </Link>
                    ) : undefined
                  }
                />
              }
            />
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}
