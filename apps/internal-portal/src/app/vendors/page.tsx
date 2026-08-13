'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { inrCompact } from '@/lib/format';
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
import { listVendors } from './apis';
import { VendorListRow, VendorStatus } from './types';

const STATUS_TONE: Record<VendorStatus, Tone> = {
  DRAFT: 'grey',
  PENDING_VERIFICATION: 'flag',
  ACTIVE: 'mint',
  SUSPENDED: 'red',
  BLACKLISTED: 'red',
};

export default function VendorsPage() {
  const router = useRouter();
  const can = useCan();
  const [rows, setRows] = useState<VendorListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | VendorStatus>('');

  const load = () => {
    setError(null);
    setRows(null);
    listVendors({ q: q || undefined, status: status || undefined })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };

  useEffect(load, [q, status]);

  const columns: Column<VendorListRow>[] = [
    {
      key: 'code',
      label: 'Vendor',
      render: (r) => (
        <div>
          <Link href={`/vendors/${r.id}`} className="mono" style={{ fontSize: 12 }}>
            {r.code}
          </Link>
          <div>{r.legalName}</div>
        </div>
      ),
    },
    { key: 'type', label: 'Type', render: (r) => <Tag tone="grey">{r.partyType}</Tag> },
    { key: 'base', label: 'Base', render: (r) => `${r.baseCity} · ${r.branchName}` },
    { key: 'phone', label: 'Phone', mono: true, render: (r) => r.phone },
    { key: 'fleet', label: 'Fleet', align: 'right', render: (r) => r.fleetCount },
    { key: 'trips', label: 'Trips', align: 'right', render: (r) => r.trips },
    { key: 'margin', label: 'Our margin', align: 'right', render: (r) => inrCompact(r.marginPaise) },
    { key: 'adv', label: 'Advance', align: 'right', render: (r) => `${r.advancePct}%` },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Tag tone={STATUS_TONE[r.status]}>{r.status.replace(/_/g, ' ')}</Tag>,
    },
  ];

  return (
    <ModuleGuard module="vendors">
      <PageHeader
        path="/vendors"
        title="Vendors"
        sub="An uncleared vendor is never assignable — BR-01 is the gate the whole supply side hangs on."
        module="vendors"
        right={
          can('vendor.edit') && (
            <Link href="/vendors/new" className="btn">
              Onboard a vendor
            </Link>
          )
        }
      />

      <Stack>
        <Panel>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 240px' }}>
              <Field label="Search">
                <input
                  placeholder="Name or vendor code"
                  defaultValue={q}
                  onBlur={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setQ((e.target as HTMLInputElement).value)}
                />
              </Field>
            </div>
            <div style={{ flex: '0 1 200px' }}>
              <Field label="Status">
                <select value={status} onChange={(e) => setStatus(e.target.value as VendorStatus | '')}>
                  <option value="">All</option>
                  {Object.keys(STATUS_TONE).map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link href="/vendors/leads" className="btn btn-secondary">
                Leads
              </Link>
              <Link href="/vendors/market-gap" className="btn btn-secondary">
                Market gap
              </Link>
              <Link href="/vendors/issues" className="btn btn-secondary">
                Issues
              </Link>
            </div>
          </div>
        </Panel>

        {error && <ErrorState message={error} retry={load} />}
        {!rows && !error && <Loading what="Loading vendors" />}
        {rows && (
          <Panel pad={false}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/vendors/${r.id}`)}
              empty="No vendor matches this search."
            />
          </Panel>
        )}
      </Stack>
    </ModuleGuard>
  );
}
