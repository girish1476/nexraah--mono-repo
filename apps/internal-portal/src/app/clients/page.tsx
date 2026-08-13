'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDate, inrCompact } from '@/lib/format';
import {
  Column,
  DataTable,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Tag,
  useLevel,
} from '@/lib/ui';
import { listClients } from './apis';
import { Client } from './types';

export default function ClientsPage() {
  const router = useRouter();
  const level = useLevel('clients');
  const [rows, setRows] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listClients().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const columns: Column<Client>[] = [
    {
      key: 'code',
      label: 'Client',
      render: (r) => (
        <div>
          <Link href={`/clients/${r.id}`} className="mono" style={{ fontSize: 12 }}>
            {r.code}
          </Link>
          <div>{r.name}</div>
        </div>
      ),
    },
    { key: 'city', label: 'Billing city', render: (r) => r.billingCity },
    { key: 'gstin', label: 'GSTIN', mono: true, render: (r) => r.gstin ?? '—' },
    {
      key: 'engagement',
      label: 'Engagement',
      render: (r) => <Tag tone={r.engagement === 'CONTRACT' ? 'blue' : 'grey'}>{r.engagement}</Tag>,
    },
    { key: 'valid', label: 'Agreement to', render: (r) => fmtDate(r.validTo) },
    { key: 'credit', label: 'Credit', align: 'right', render: (r) => `${r.creditDays} days` },
    { key: 'out', label: 'Outstanding', align: 'right', render: (r) => inrCompact(r.outstandingPaise) },
  ];

  return (
    <ModuleGuard module="clients">
      <PageHeader
        path="/clients"
        title="Clients"
        sub="Rate cards are read-only here — they are the lanes won at RFQ (BR-37)."
        module="clients"
        right={
          level === 'EDIT' && (
            <Link href="/clients/new" className="btn">
              New client
            </Link>
          )
        }
      />
      {error && <ErrorState message={error} retry={load} />}
      {!rows && !error && <Loading what="Loading clients" />}
      {rows && (
        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/clients/${r.id}`)}
          />
        </Panel>
      )}
    </ModuleGuard>
  );
}
