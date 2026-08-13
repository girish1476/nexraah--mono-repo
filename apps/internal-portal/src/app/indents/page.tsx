'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate, inr } from '@/lib/format';
import {
  Column,
  DataTable,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  Tag,
  Tone,
  useCan,
} from '@/lib/ui';
import { listIndents } from './apis';
import { IndentListRow, IndentStage } from './types';

const STAGES: IndentStage[] = ['OPEN', 'VENDOR_ASSIGNED', 'VEHICLE_PLACED', 'TRIP_CREATED'];

const STAGE_TONE: Record<IndentStage, Tone> = {
  OPEN: 'grey',
  VENDOR_ASSIGNED: 'blue',
  VEHICLE_PLACED: 'flag',
  TRIP_CREATED: 'mint',
};

export default function IndentsPage() {
  const router = useRouter();
  const can = useCan();
  const [rows, setRows] = useState<IndentListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'' | IndentStage>('');

  const load = () => {
    setError(null);
    setRows(null);
    listIndents({ stage: stage || undefined })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [stage]);

  const columns: Column<IndentListRow>[] = [
    {
      key: 'code',
      label: 'Indent',
      render: (r) => (
        <Link href={`/indents/${r.id}`} className="mono" style={{ fontSize: 12 }}>
          {r.code}
        </Link>
      ),
    },
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    {
      key: 'lane',
      label: 'Lane',
      render: (r) => (
        <div>
          <div>{r.lane}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {r.material} · {r.weightTn} MT · {r.truckType}
          </div>
        </div>
      ),
    },
    { key: 'pickup', label: 'Pickup', render: (r) => fmtDate(r.pickupDate) },
    { key: 'sell', label: 'Freight', align: 'right', render: (r) => inr(r.sellRatePaise) },
    {
      key: 'buy',
      label: 'Buy rate',
      align: 'right',
      render: (r) => (r.buyRatePaise ? inr(r.buyRatePaise) : <span className="muted">—</span>),
    },
    { key: 'quotes', label: 'Quotes', align: 'right', render: (r) => r.quoteCount },
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    {
      key: 'stage',
      label: 'Stage',
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
        title="Indents"
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
      <Stack>
        <Panel>
          <div style={{ maxWidth: 240 }}>
            <Field label="Stage">
              <select value={stage} onChange={(e) => setStage(e.target.value as IndentStage | '')}>
                <option value="">All</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Panel>
        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading indents" />}
        {rows && (
          <Panel pad={false}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/indents/${r.id}`)}
            />
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}
