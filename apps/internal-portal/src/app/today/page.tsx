'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate, inr, inrCompact } from '@/lib/format';
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
import { Issue } from '@/app/vendors/types';
import { getToday } from './apis';
import { FailureCause, TodayResponse } from './types';

const CAUSE_LABEL: Record<FailureCause, string> = {
  NO_QUOTE_AT_ALL: 'No quote at all',
  ONLY_ABOVE_BAND_QUOTES: 'Only above-band quotes',
  IN_BAND_NONE_AWARDED: 'Quotes in band, none awarded',
  TRUCK_NEVER_REPORTED: 'Truck never reported',
  CLIENT_CANCELLED: 'Client cancelled',
};

const SEVERITY_TONE: Record<Issue['severity'], Tone> = { LOW: 'grey', MEDIUM: 'flag', HIGH: 'red' };

/**
 * Today — `/today` (part 10 §1).
 *
 * Not a dashboard. Every panel is a list of things someone must act on today.
 */
export default function TodayPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getToday().then(setData).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading your queues" />;

  const allocationColumns: Column<TodayResponse['pendingAllocation']['rows'][number]>[] = [
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
    { key: 'lane', label: 'Lane', render: (r) => r.lane },
    { key: 'load', label: 'Load', render: (r) => `${r.weightTn} MT · ${r.truckType}` },
    { key: 'pickup', label: 'Pickup', render: (r) => fmtDate(r.pickupDate) },
    { key: 'freight', label: 'Freight', align: 'right', render: (r) => inr(r.sellRatePaise) },
    {
      key: 'quotes',
      label: 'Quotes',
      align: 'right',
      render: (r) => <Tag tone={r.quoteCount ? 'mint' : 'red'}>{r.quoteCount}</Tag>,
    },
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
  ];

  const failureColumns: Column<TodayResponse['placementFailures']['rows'][number]>[] = [
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
    { key: 'lane', label: 'Lane', render: (r) => r.lane },
    { key: 'pickup', label: 'Pickup was', render: (r) => fmtDate(r.pickupDate) },
    { key: 'freight', label: 'Freight lost', align: 'right', render: (r) => inr(r.sellRatePaise) },
    {
      key: 'cause',
      label: 'Cause',
      render: (r) => (
        <Tag tone={r.cause === 'ONLY_ABOVE_BAND_QUOTES' ? 'flag' : 'red'}>{CAUSE_LABEL[r.cause] ?? r.cause}</Tag>
      ),
    },
    { key: 'branch', label: 'Branch', render: (r) => r.branchName },
  ];

  return (
    <ModuleGuard module="today">
      <PageHeader path="/today" title="Today" sub="Your working queues" module="today" />

      <Stack gap={20}>
        <div>
          <StatStrip
            stats={[
              { k: 'Waiting', v: data.pendingAllocation.stats.waiting },
              { k: 'Freight at stake', v: inrCompact(data.pendingAllocation.stats.freightAtStakePaise) },
              { k: 'No quotes yet', v: data.pendingAllocation.stats.noQuotes, tone: 'red' },
              { k: 'Quotes in', v: data.pendingAllocation.stats.quotesIn, tone: 'mint' },
              { k: 'Earliest pickup', v: fmtDate(data.pendingAllocation.stats.earliestPickup) },
              { k: 'Tonnes', v: data.pendingAllocation.stats.tonnes },
            ]}
          />
          <div style={{ marginTop: 12 }}>
            <Panel title="Trips pending allocation" pad={false}>
              <DataTable
                columns={allocationColumns}
                rows={data.pendingAllocation.rows}
                rowKey={(r) => r.id}
                empty="Everything is placed."
              />
            </Panel>
          </div>
        </div>

        <div>
          <StatStrip
            stats={[
              { k: 'Failed', v: data.placementFailures.stats.failed, tone: 'red' },
              { k: 'Freight lost', v: inrCompact(data.placementFailures.stats.freightLostPaise), tone: 'red' },
              { k: 'Never quoted', v: data.placementFailures.stats.neverQuoted },
            ]}
          />
          <div style={{ marginTop: 12 }}>
            <Panel
              title="Placement failures"
              right={
                <Link href="/vendors/market-gap" style={{ fontSize: 12 }}>
                  Market gap →
                </Link>
              }
              pad={false}
            >
              <DataTable
                columns={failureColumns}
                rows={data.placementFailures.rows}
                rowKey={(r) => r.id}
                empty="No placement failures."
              />
              <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px', lineHeight: 1.45 }}>
                A lane that repeatedly draws nothing but above-band quotes has a band set below the market. That
                is a recruitment problem, and the band is not widened to fix it (BR-39, D-19).
              </div>
            </Panel>
          </div>
        </div>

        <Panel title="POD overdue" pad={false}>
          <DataTable
            columns={[
              {
                key: 'trip',
                label: 'Trip',
                render: (r: TodayResponse['podOverdue']['rows'][number]) => (
                  <Link href={`/trips/${r.tripId}`} className="mono" style={{ fontSize: 12 }}>
                    {r.tripCode}
                  </Link>
                ),
              },
              { key: 'lane', label: 'Lane', render: (r) => r.lane },
              { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
              {
                key: 'age',
                label: 'Day',
                align: 'right',
                render: (r) => <span style={{ color: r.ageDays > 20 ? 'var(--red)' : undefined }}>{r.ageDays}</span>,
              },
              { key: 'held', label: 'Balance held', align: 'right', render: (r) => inr(r.balanceHeldPaise) },
            ]}
            rows={data.podOverdue.rows}
            rowKey={(r) => r.tripId}
            empty="Every proof of delivery is in."
          />
        </Panel>

        <Panel title="Vendor issues" pad={false}>
          <DataTable
            columns={[
              { key: 'code', label: 'Issue', mono: true, render: (r: Issue) => r.code },
              { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
              { key: 'category', label: 'Category', render: (r) => r.category.replace(/_/g, ' ').toLowerCase() },
              { key: 'sev', label: 'Severity', render: (r) => <Tag tone={SEVERITY_TONE[r.severity]}>{r.severity}</Tag> },
              { key: 'note', label: 'Note', render: (r) => <span className="muted">{r.note}</span> },
            ]}
            rows={data.vendorIssues.rows}
            rowKey={(r) => r.id}
            empty="No open issues."
          />
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}
