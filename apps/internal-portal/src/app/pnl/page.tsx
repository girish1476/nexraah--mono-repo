'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate, inrCompact, marginPct, pct } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  StatStrip,
  Tag,
} from '@/lib/ui';
import { getPnl, getPnlExceptions, pnlExportUrl } from './apis';
import { Granularity, PnlException, PnlResponse, PnlRow } from './types';

/** P&L — `/pnl` (part 10 §3). */
export default function PnlPage() {
  const [granularity, setGranularity] = useState<Granularity>('MONTHLY');
  const [branch, setBranch] = useState('');
  const [data, setData] = useState<PnlResponse | null>(null);
  const [exceptions, setExceptions] = useState<PnlException[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setData(null);
    Promise.all([getPnl({ granularity, branch: branch || undefined }), getPnlExceptions()])
      .then(([p, e]) => {
        setData(p);
        setExceptions(e);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [granularity, branch]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading the P&L" />;

  const totals = data.rows.reduce(
    (a, r) => ({
      placementPaise: a.placementPaise + r.placementPaise,
      loadingPaise: a.loadingPaise + r.loadingPaise,
      unloadingPaise: a.unloadingPaise + r.unloadingPaise,
      detentionPaise: a.detentionPaise + r.detentionPaise,
      otherPaise: a.otherPaise + r.otherPaise,
      costPaise: a.costPaise + r.costPaise,
      revenuePaise: a.revenuePaise + r.revenuePaise,
      marginPaise: a.marginPaise + r.marginPaise,
    }),
    {
      placementPaise: 0,
      loadingPaise: 0,
      unloadingPaise: 0,
      detentionPaise: 0,
      otherPaise: 0,
      costPaise: 0,
      revenuePaise: 0,
      marginPaise: 0,
    },
  );

  const columns: Column<PnlRow>[] = [
    { key: 'period', label: granularity === 'MONTHLY' ? 'Branch / period' : 'Period', render: (r) => r.period },
    { key: 'placement', label: 'Placement rate', align: 'right', render: (r) => inrCompact(r.placementPaise) },
    { key: 'loading', label: 'Loading', align: 'right', render: (r) => inrCompact(r.loadingPaise) },
    { key: 'unloading', label: 'Unloading', align: 'right', render: (r) => inrCompact(r.unloadingPaise) },
    { key: 'detention', label: 'Detention', align: 'right', render: (r) => inrCompact(r.detentionPaise) },
    { key: 'other', label: 'Other', align: 'right', render: (r) => inrCompact(r.otherPaise) },
    { key: 'cost', label: 'Total cost', align: 'right', render: (r) => inrCompact(r.costPaise) },
    { key: 'revenue', label: 'Customer rate', align: 'right', render: (r) => inrCompact(r.revenuePaise) },
    { key: 'margin', label: 'Margin', align: 'right', render: (r) => inrCompact(r.marginPaise) },
    {
      key: 'pct',
      label: '%',
      align: 'right',
      render: (r) => {
        const m = marginPct(r.revenuePaise, r.costPaise);
        return <span style={{ color: m >= 12 ? 'var(--mint)' : m >= 10 ? 'var(--flag)' : 'var(--red)' }}>{pct(m)}</span>;
      },
    },
  ];

  return (
    <ModuleGuard module="pnl">
      <PageHeader
        path="/pnl"
        title="P&L"
        sub={data.scope}
        module="pnl"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <a className="btn btn-secondary" href={pnlExportUrl({ granularity, branch })}>
              Export CSV
            </a>
            <Link href="/print/pnl" className="btn btn-secondary" target="_blank">
              Print
            </Link>
          </div>
        }
      />

      <Stack>
        <Panel>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 200px' }}>
              <Field label="Granularity">
                <select value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)}>
                  <option value="DAILY">Daily</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                </select>
              </Field>
            </div>
            <div style={{ flex: '0 1 200px' }}>
              <Field label="Branch">
                <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="All" />
              </Field>
            </div>
          </div>
        </Panel>

        <StatStrip
          stats={[
            { k: 'Customer rate', v: inrCompact(totals.revenuePaise) },
            { k: 'Total cost', v: inrCompact(totals.costPaise) },
            { k: 'Margin', v: inrCompact(totals.marginPaise), tone: 'mint' },
            { k: 'Margin %', v: pct(marginPct(totals.revenuePaise, totals.costPaise)) },
          ]}
        />

        <Panel pad={false}>
          <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.period} />
          <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px', lineHeight: 1.45 }}>
            Cost is built from the buy rate and every charge line booked against the load. No percentage appears
            anywhere in this query — which is why the figure is only as good as the charge capture on each trip.
          </div>
        </Panel>

        {exceptions.length > 0 && (
          <Panel title="Exceptions — closed trips with no charges captured" pad={false}>
            <Banner tone="flag" title={`${exceptions.length} trip(s) overstate margin`}>
              Nothing else will tell you this (R-01). The weekly charge-capture-exception job populates this
              panel.
            </Banner>
            <DataTable
              columns={[
                {
                  key: 'trip',
                  label: 'Trip',
                  render: (r: PnlException) => (
                    <Link href={`/trips/${r.tripId}/charges`} className="mono" style={{ fontSize: 12 }}>
                      {r.tripCode}
                    </Link>
                  ),
                },
                { key: 'lane', label: 'Lane', render: (r) => r.lane },
                { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
                { key: 'branch', label: 'Branch', render: (r) => r.branchName },
                { key: 'delivered', label: 'Delivered', render: (r) => fmtDate(r.deliveredAt) },
                { key: 'buy', label: 'Buy rate', align: 'right', render: (r) => inrCompact(r.buyRatePaise) },
                { key: 'flag', label: '', render: () => <Tag tone="flag">No charges</Tag> },
              ]}
              rows={exceptions}
              rowKey={(r) => r.tripId}
            />
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}
