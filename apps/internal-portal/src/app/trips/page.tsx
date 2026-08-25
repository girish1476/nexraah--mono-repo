'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate, inr } from '@/lib/format';
import {
  Column,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
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

/** Trip search — `/trips` (part 05 §1). Search spans indents and trips together. */
export default function TripsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<TripListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [podStatus, setPodStatus] = useState('');

  const load = () => {
    setError(null);
    setRows(null);
    listTrips({ q: q || undefined, stage: stage || undefined, pod_status: podStatus || undefined })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [q, stage, podStatus]);

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
        who="Operations and branch managers live in this list day to day; everyone else can look a trip up here too."
      />
      <Stack>
        <Panel>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}>
              <Field label="Search" hint="LR · trip · indent · truck · transporter · client · branch">
                <input
                  placeholder="Any of the above"
                  defaultValue={q}
                  onBlur={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setQ((e.target as HTMLInputElement).value)}
                />
              </Field>
            </div>
            <div style={{ flex: '0 1 180px' }}>
              <Field label="Stage">
                <select value={stage} onChange={(e) => setStage(e.target.value)}>
                  <option value="">All</option>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ flex: '0 1 180px' }}>
              <Field label="POD status">
                <select value={podStatus} onChange={(e) => setPodStatus(e.target.value)}>
                  <option value="">All</option>
                  {POD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </Panel>
        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading trips" />}
        {rows && (
          <Panel pad={false}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/trips/${r.id}`)}
              empty={
                <EmptyState
                  title={q || stage || podStatus ? 'No trip matches this search' : 'No trips yet'}
                  hint={
                    q || stage || podStatus
                      ? 'Try a different LR, trip, indent, truck, transporter or client, or clear the stage and POD status filters.'
                      : 'A trip is created once a vehicle is placed against an indent. Place one there and it will show up here.'
                  }
                  action={
                    !(q || stage || podStatus) ? (
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
