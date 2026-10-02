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

/** Home — `/home` (part 10 §2). Leadership lands here; operations can open it. */
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
    { key: 'branch', label: 'Branch', primary: true, render: (r) => r.branchName },
    { key: 'trips', label: 'Loads moved', align: 'right', render: (r) => r.trips },
    { key: 'rev', label: 'Billed to clients', align: 'right', render: (r) => inrCompact(r.revenuePaise) },
    { key: 'cost', label: 'Paid to transporters', align: 'right', render: (r) => inrCompact(r.costPaise) },
    {
      key: 'margin',
      label: 'What we kept',
      align: 'right',
      render: (r) => inrCompact(r.revenuePaise - r.costPaise),
    },
    {
      key: 'pctv',
      label: 'Kept per ₹100',
      align: 'right',
      render: (r) => {
        const m = marginPct(r.revenuePaise, r.costPaise);
        return <span style={{ color: m >= 12 ? 'var(--mint)' : m >= 10 ? 'var(--flag)' : 'var(--red)' }}>{pct(m)}</span>;
      },
    },
    {
      key: 'share',
      label: 'Share of the month',
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

  /*
   * One screen, no scrolling (owner's direction, 2026-10-03). `.snapshot` in
   * globals.css shrinks the tiles, glyphs, panel chrome and table rows, hides
   * the per-tile notes, and lays the panels out side by side so the whole
   * month fits a laptop viewport.
   */
  return (
    <ModuleGuard module="home">
     <div className="snapshot">
      <PageHeader
        path="/home"
        title="Business snapshot"
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
      {/* The intro, the "on track" banner and three of the four key metrics
          were dropped (owner's direction, 2026-10-03): the page leads with
          on-time placement alone, then the month's detail, already open. */}
      <Stack gap={8}>
        <StatStrip
          stats={[
            {
              k: 'Vehicles placed on time', id: 'home-on-time',
              v: pct(data.month.onTimePct),
              emoji: '⏱️',
              note: 'Truck at the pickup point by the promised date',
              tone: data.month.onTimePct >= 90 ? 'mint' : data.month.onTimePct >= 70 ? 'flag' : 'red',
            },
          ]}
        />

        <details open>
          <summary
            style={{
              cursor: 'pointer',
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 13,
              color: 'var(--color-accent-700)',
              padding: '0 2px',
              userSelect: 'none',
            }}
          >
            Monthly performance
          </summary>
          <div className="snapshot-grid">
              <div id="this-month" className="snapshot-wide">
                <Panel title="📅 Volume & revenue">
                  <StatStrip
                    stats={[
                      { k: 'Loads moved', id: 'month-loads', v: data.month.trips, emoji: '🚚' },
                      {
                        k: 'Billed to clients', id: 'month-billed',
                        v: inrCompact(data.month.revenuePaise),
                        emoji: '💰',
                        note: 'What we charged for the work',
                      },
                      {
                        k: 'Paid to transporters', id: 'month-paid',
                        v: inrCompact(data.month.costPaise),
                        emoji: '💸',
                        note: 'What the vehicles cost us',
                      },
                      {
                        k: 'What we kept', id: 'month-kept',
                        v: inrCompact(data.month.marginPaise),
                        emoji: '📈',
                        tone: 'mint',
                        note: 'Billed minus paid, before overheads',
                      },
                      {
                        k: 'Kept per 100 rupees billed', id: 'month-kept-pct',
                        v: pct(marginPct(data.month.revenuePaise, data.month.costPaise)),
                        emoji: '🧮',
                      },
                      { k: 'Transporters we used', id: 'month-transporters', v: data.month.vendorsUsed, emoji: '🤝' },
                      {
                        k: 'Placed on time', id: 'month-on-time',
                        v: pct(data.month.onTimePct),
                        emoji: '⏱️',
                        tone: data.month.onTimePct >= 90 ? 'mint' : data.month.onTimePct >= 70 ? 'flag' : 'red',
                      },
                      {
                        k: 'Trucks there by pickup day', id: 'month-placed-by-pickup',
                        v: data.month.placedByPickup,
                        emoji: '✅',
                      },
                      {
                        k: 'Unassigned loads', id: 'month-failures',
                        v: data.month.failures,
                        emoji: '🚨',
                        tone: data.month.failures > 0 ? 'red' : undefined,
                      },
                      { k: 'Different trucks used', id: 'month-trucks', v: data.month.distinctTrucks, emoji: '🚛' },
                    ]}
                  />
                </Panel>
              </div>

              <div id="pod-collection" className="snapshot-major">
                <Panel title="📸 Delivery documents">
                  <StatStrip
                    stats={[
                      { k: 'Loads delivered', id: 'pod-delivered', v: data.pod.delivered, emoji: '📦' },
                      {
                        k: 'Signed paper received', id: 'pod-collected',
                        v: data.pod.collected,
                        emoji: '✅',
                        tone: 'mint',
                      },
                      {
                        k: 'Still to come in', id: 'pod-pending',
                        v: data.pod.pending,
                        emoji: '⌛',
                        tone: data.pod.pending > 0 ? 'flag' : undefined,
                      },
                      { k: 'Arrived on time', id: 'pod-within-tat', v: data.pod.withinTat, emoji: '⏱️' },
                      {
                        k: 'Past the deadline', id: 'pod-breached',
                        v: data.pod.breached,
                        emoji: '⏰',
                        tone: data.pod.breached > 0 ? 'red' : undefined,
                      },
                      {
                        k: 'Share we got back', id: 'pod-collection-pct',
                        v: pct(data.pod.collectionPct),
                        emoji: '📊',
                      },
                      {
                        k: 'Penalties we can charge', id: 'pod-penalty',
                        v: inrCompact(data.pod.penaltyAccruedPaise),
                        emoji: '⚖️',
                        note: 'Deductible from transporters who ran late',
                        tone: data.pod.penaltyAccruedPaise > 0 ? 'red' : undefined,
                      },
                    ]}
                  />
                </Panel>
              </div>

              <div id="standing" className="snapshot-minor">
                <Panel title="💰 Cash flow">
                  <StatStrip
                    stats={[
                      {
                        k: 'Advances we have paid out', id: 'standing-advances',
                        v: inrCompact(data.standing.advanceOutstandingPaise),
                        emoji: '⏩',
                        note: 'Part-payments made before delivery',
                      },
                      {
                        k: 'Final payments still owed', id: 'standing-final-owed',
                        v: inrCompact(data.standing.balancePendingPaise),
                        emoji: '🏁',
                        note: 'Owed to transporters once proof is in',
                        tone: data.standing.balancePendingPaise > 0 ? 'flag' : undefined,
                      },
                      {
                        k: 'Owed to us by clients', id: 'standing-receivables',
                        v: inrCompact(data.standing.receivablesPaise),
                        emoji: '📥',
                        note: 'Bills raised and not yet paid',
                      },
                      {
                        k: 'Delivered but not billed', id: 'standing-not-billed',
                        v: data.standing.unbilledTrips,
                        emoji: '🧾',
                        note: 'Raise these and the money starts moving',
                        tone: data.standing.unbilledTrips > 0 ? 'flag' : undefined,
                      },
                    ]}
                  />
                </Panel>
              </div>

              <div className="snapshot-major">
                <Panel title="🏬 Branch performance" pad={false}>
                  <DataTable columns={branchColumns} rows={data.branches} rowKey={(r) => r.branchName} />
                </Panel>
              </div>

              <div className="snapshot-minor">
              <Panel title="🏢 Top clients" pad={false}>
                <DataTable
                  columns={[
                    { key: 'client', label: 'Client', primary: true, render: (r: HomeResponse['topClients'][number]) => r.clientName },
                    { key: 'rev', label: 'Billed to them', align: 'right', render: (r) => inrCompact(r.revenuePaise) },
                    {
                      key: 'share',
                      label: 'Share of the month',
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
              </div>
          </div>
        </details>
      </Stack>
     </div>
    </ModuleGuard>
  );
}
