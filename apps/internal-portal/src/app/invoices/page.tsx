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
  StatStrip,
  Tag,
  Tone,
  useCan,
} from '@/lib/ui';
import { listInvoices } from './apis';
import { Invoice, InvoiceStatus } from './types';

const STATUSES: InvoiceStatus[] = ['DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'CANCELLED'];
const TONE: Record<InvoiceStatus, Tone> = {
  DRAFT: 'grey',
  ISSUED: 'blue',
  PART_PAID: 'flag',
  PAID: 'mint',
  CANCELLED: 'red',
};

/** Invoice ledger — `/invoices` (part 08 §2). No GST columns anywhere. */
export default function InvoicesPage() {
  const router = useRouter();
  const can = useCan();
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | InvoiceStatus>('');
  const [q, setQ] = useState('');

  const load = () => {
    setError(null);
    setRows(null);
    listInvoices({ status: status || undefined, q: q || undefined })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [status, q]);

  const columns: Column<Invoice>[] = [
    {
      key: 'code',
      label: 'Invoice',
      render: (r) => (
        <Link href={`/invoices/${r.id}`} className="mono" style={{ fontSize: 12 }}>
          {r.code ?? 'draft'}
        </Link>
      ),
    },
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    { key: 'date', label: 'Invoice date', render: (r) => fmtDate(r.invoiceDate) },
    { key: 'due', label: 'Due', render: (r) => fmtDate(r.dueDate) },
    { key: 'trips', label: 'Consignments', align: 'right', render: (r) => r.tripIds.length },
    { key: 'total', label: 'Value', align: 'right', render: (r) => inr(r.totalPaise) },
    { key: 'received', label: 'Received', align: 'right', render: (r) => inr(r.receivedPaise) },
    { key: 'balance', label: 'Balance', align: 'right', render: (r) => inr(r.totalPaise - r.receivedPaise) },
    { key: 'status', label: 'Status', render: (r) => <Tag tone={TONE[r.status]}>{r.status.replace(/_/g, ' ')}</Tag> },
  ];

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading the ledger" />;

  const open = rows.filter((r) => ['ISSUED', 'PART_PAID'].includes(r.status));

  return (
    <ModuleGuard module="invoices">
      <PageHeader
        path="/invoices"
        title="Invoices"
        sub="Reverse charge throughout — no tax is charged on any invoice this entity raises (BR-15)."
        module="invoices"
        right={
          can('invoice.create') && (
            <Link href="/invoices/new" className="btn">
              New invoice
            </Link>
          )
        }
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Open invoices', v: open.length },
            { k: 'Open value', v: inr(open.reduce((a, r) => a + (r.totalPaise - r.receivedPaise), 0)), tone: 'flag' },
            { k: 'Paid this period', v: rows.filter((r) => r.status === 'PAID').length, tone: 'mint' },
            { k: 'Cancelled', v: rows.filter((r) => r.status === 'CANCELLED').length },
          ]}
        />

        <Panel>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}>
              <Field label="Search" hint="Number, client or phone">
                <input
                  defaultValue={q}
                  onBlur={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setQ((e.target as HTMLInputElement).value)}
                />
              </Field>
            </div>
            <div style={{ flex: '0 1 180px' }}>
              <Field label="Status">
                <select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')}>
                  <option value="">All</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </Panel>

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/invoices/${r.id}`)}
          />
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}
