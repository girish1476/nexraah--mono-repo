'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { inrCompact, marginPct, pct } from '@/lib/format';
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
} from '@/lib/ui';
import { getHome } from './apis';
import { HomeResponse } from './types';

/** Home — `/home` (part 10 §2). Leadership and branch managers land here. */
export default function HomePage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<HomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setData(null);
    getHome(month).then(setData).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [month]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading the month" />;

  const branchColumns: Column<HomeResponse['branches'][number]>[] = [
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
    { key: 'trips', label: 'Trips', align: 'right', render: (r) => r.trips },
    { key: 'rev', label: 'Revenue', align: 'right', render: (r) => inrCompact(r.revenuePaise) },
    { key: 'cost', label: 'Cost', align: 'right', render: (r) => inrCompact(r.costPaise) },
    { key: 'margin', label: 'Margin', align: 'right', render: (r) => inrCompact(r.revenuePaise - r.costPaise) },
    {
      key: 'pctv',
      label: '%',
      align: 'right',
      render: (r) => {
        const m = marginPct(r.revenuePaise, r.costPaise);
        return <span style={{ color: m >= 12 ? 'var(--mint)' : m >= 10 ? 'var(--flag)' : 'var(--red)' }}>{pct(m)}</span>;
      },
    },
    {
      key: 'share',
      label: 'Share',
      render: (r) => {
        const total = data.branches.reduce((a, b) => a + b.revenuePaise, 0) || 1;
        return (
          <div style={{ minWidth: 110 }}>
            <div className="bar">
              <span style={{ width: `${(r.revenuePaise / total) * 100}%` }} />
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <ModuleGuard module="home">
      <PageHeader
        path="/home"
        title="Home"
        sub="Month to date"
        module="home"
        right={
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{
              padding: '7px 9px',
              border: '1px solid var(--color-divider)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'inherit',
            }}
          />
        }
      />

      <Stack gap={20}>
        <div>
          <h2 style={{ marginBottom: 8 }}>This month</h2>
          <StatStrip
            stats={[
              { k: 'Trips', v: data.month.trips },
              { k: 'Revenue', v: inrCompact(data.month.revenuePaise) },
              { k: 'Transporter cost', v: inrCompact(data.month.costPaise) },
              { k: 'Gross margin', v: inrCompact(data.month.marginPaise), tone: 'mint' },
              { k: 'Margin %', v: pct(marginPct(data.month.revenuePaise, data.month.costPaise)) },
              { k: 'Transporters used', v: data.month.vendorsUsed },
            ]}
          />
          <div style={{ marginTop: 12 }}>
            <StatStrip
              stats={[
                {
                  k: 'On time',
                  v: pct(data.month.onTimePct),
                  tone: data.month.onTimePct >= 90 ? 'mint' : data.month.onTimePct >= 70 ? 'flag' : 'red',
                },
                { k: 'Placed by pickup date', v: data.month.placedByPickup },
                { k: 'Failures', v: data.month.failures, tone: 'red' },
                { k: 'Distinct trucks', v: data.month.distinctTrucks },
              ]}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <Panel title="Branches" pad={false}>
              <DataTable columns={branchColumns} rows={data.branches} rowKey={(r) => r.branchName} />
            </Panel>
          </div>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>POD collection</h2>
          <StatStrip
            stats={[
              { k: 'Delivered', v: data.pod.delivered },
              { k: 'Collected', v: data.pod.collected, tone: 'mint' },
              { k: 'Pending', v: data.pod.pending, tone: 'flag' },
              { k: 'Within turnaround', v: data.pod.withinTat },
              { k: 'Breached', v: data.pod.breached, tone: 'red' },
              { k: 'Collection %', v: pct(data.pod.collectionPct) },
              { k: 'Penalty accrued', v: inrCompact(data.pod.penaltyAccruedPaise), tone: 'red' },
            ]}
          />
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>Where things stand</h2>
          <StatStrip
            stats={[
              { k: 'Advance outstanding', v: inrCompact(data.standing.advanceOutstandingPaise) },
              { k: 'Balance pending', v: inrCompact(data.standing.balancePendingPaise), tone: 'flag' },
              { k: 'Receivables', v: inrCompact(data.standing.receivablesPaise) },
              { k: 'Unbilled trips', v: data.standing.unbilledTrips, tone: 'flag' },
            ]}
          />
        </div>

        <Panel title="Top clients" pad={false}>
          <DataTable
            columns={[
              { key: 'client', label: 'Client', render: (r: HomeResponse['topClients'][number]) => r.clientName },
              { key: 'rev', label: 'Revenue', align: 'right', render: (r) => inrCompact(r.revenuePaise) },
              {
                key: 'share',
                label: 'Share',
                render: (r) => {
                  const total = data.topClients.reduce((a, c) => a + c.revenuePaise, 0) || 1;
                  return (
                    <div style={{ minWidth: 120 }}>
                      <div className="bar">
                        <span style={{ width: `${(r.revenuePaise / total) * 100}%` }} />
                      </div>
                    </div>
                  );
                },
              },
            ]}
            rows={data.topClients}
            rowKey={(r) => r.clientName}
          />
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}
