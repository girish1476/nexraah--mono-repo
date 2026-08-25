'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { inrCompact, marginPct, pct } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
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

  // This page carries three stacked stat groups and two tables — genuinely a
  // lot for anyone's first look. One synthesized line up top says what, if
  // anything, actually needs a decision this month before the detail below.
  const attention = [
    data.standing.unbilledTrips > 0
      ? {
          label: `🧾 ${data.standing.unbilledTrips} delivered load${data.standing.unbilledTrips === 1 ? '' : 's'} we have not billed yet`,
          href: '#standing',
        }
      : null,
    data.pod.breached > 0
      ? {
          label: `📸 ${data.pod.breached} deliver${data.pod.breached === 1 ? 'y is' : 'ies are'} past the paperwork deadline`,
          href: '#pod-collection',
        }
      : null,
    data.month.failures > 0
      ? {
          label: `🚨 ${data.month.failures} load${data.month.failures === 1 ? '' : 's'} we could not put a vehicle on`,
          href: '#this-month',
        }
      : null,
    data.month.onTimePct < 70
      ? {
          label: `⏱️ Only ${pct(data.month.onTimePct)} of vehicles reached the pickup point on time`,
          href: '#this-month',
        }
      : null,
  ].filter((x): x is { label: string; href: string } => x !== null);

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

  return (
    <ModuleGuard module="home">
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
      <PageIntro
        what="How the business is doing this month — what we moved, what we made, and what is still owed in either direction."
        who="Leadership and branch managers read this monthly. Day-to-day work lives on My desk."
      />

      <div style={{ marginBottom: 20 }}>
        {attention.length > 0 ? (
          <Banner tone="flag" title="Worth a look this month">
            {attention.map((item, i) => (
              <span key={item.href + item.label}>
                {i > 0 && ' · '}
                <a href={item.href}>{item.label}</a>
              </span>
            ))}
          </Banner>
        ) : (
          <Banner tone="mint" title="On track">
            Nothing below is off plan right now — no loads missed, delivery paperwork is coming back
            on time, and everything delivered has been billed.
          </Banner>
        )}
      </div>

      <Stack gap={20}>
        <Panel title="📌 The four numbers that matter">
          <StatStrip
            stats={[
              {
                k: 'Delivered but not billed', id: 'home-not-billed',
                v: data.standing.unbilledTrips,
                emoji: '🧾',
                note: 'Money we have earned and not yet asked for',
                tone: data.standing.unbilledTrips > 0 ? 'flag' : undefined,
              },
              {
                k: 'Delivery proof overdue', id: 'home-proof-overdue',
                v: data.pod.breached,
                emoji: '📸',
                note: 'Past the deadline the transporter agreed to',
                tone: data.pod.breached > 0 ? 'red' : undefined,
              },
              {
                k: 'Loads we could not place', id: 'home-failures',
                v: data.month.failures,
                emoji: '🚨',
                note: 'No vehicle went against them at all',
                tone: data.month.failures > 0 ? 'red' : undefined,
              },
              {
                k: 'Vehicles placed on time', id: 'home-on-time',
                v: pct(data.month.onTimePct),
                emoji: '⏱️',
                note: 'Truck at the pickup point by the promised date',
                tone: data.month.onTimePct >= 90 ? 'mint' : data.month.onTimePct >= 70 ? 'flag' : 'red',
              },
            ]}
          />
        </Panel>

        <details>
          <summary
            style={{
              cursor: 'pointer',
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 15,
              color: 'var(--color-accent-700)',
              padding: '6px 2px',
              userSelect: 'none',
            }}
          >
            Show the full monthly detail
          </summary>
          <div style={{ marginTop: 16 }}>
            <Stack gap={20}>
              <div id="this-month">
                <Panel title="📅 What we moved and what we made">
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
                    ]}
                  />
                  <div style={{ marginTop: 12 }}>
                    <StatStrip
                      stats={[
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
                          k: 'Loads we could not place', id: 'month-failures',
                          v: data.month.failures,
                          emoji: '🚨',
                          tone: data.month.failures > 0 ? 'red' : undefined,
                        },
                        { k: 'Different trucks used', id: 'month-trucks', v: data.month.distinctTrucks, emoji: '🚛' },
                      ]}
                    />
                  </div>
                </Panel>
              </div>

              <Panel title="🏬 How each branch did" pad={false}>
                <DataTable columns={branchColumns} rows={data.branches} rowKey={(r) => r.branchName} />
              </Panel>

              <div id="pod-collection">
                <Panel title="📸 Signed delivery paperwork">
                  <div className="hint" style={{ marginBottom: 12 }}>
                    A load is only finished once the signed paper comes back from the delivery
                    point. Until it does, we cannot bill the client and the transporter&apos;s final
                    payment stays held.
                  </div>
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

              <div id="standing">
                <Panel title="💰 Money in and money out">
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

              <Panel title="🏢 Our biggest clients this month" pad={false}>
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
            </Stack>
          </div>
        </details>
      </Stack>
    </ModuleGuard>
  );
}
