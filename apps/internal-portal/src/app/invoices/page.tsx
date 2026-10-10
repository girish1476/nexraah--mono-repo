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
  StatStrip,
  Tag,
  Tone,
  useCan,
} from '@/lib/ui';
import { listTrips } from '@/app/trips/apis';
import type { TripListRow } from '@/app/trips/types';
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

  // Orders on the road or delivered, not on an invoice yet — billing starts the
  // moment the truck is in transit, so these show here with a button to bill.
  const [ready, setReady] = useState<TripListRow[] | null>(null);
  // Loads ticked to go on one invoice together. An invoice goes to one client,
  // so once one load is ticked only that client's other loads can be.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const pickedRows = (ready ?? []).filter((r) => picked[r.id]);
  const pickedClient = pickedRows[0]?.clientName ?? null;
  const sameClient = (ready ?? []).filter((r) => r.clientName === pickedClient);

  const load = () => {
    setError(null);
    setRows(null);
    listInvoices({ status: status || undefined, q: q || undefined })
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
    listTrips({ invoiceable: '1' })
      .then(setReady)
      .catch(() => setReady([]));
  };
  useEffect(load, [status, q]);

  const readyColumns: Column<TripListRow>[] = [
    ...(can('invoice.create')
      ? [
          {
            key: 'pick',
            label: '',
            render: (r: TripListRow) => {
              const other = !!pickedClient && r.clientName !== pickedClient;
              return (
                <input
                  type="checkbox"
                  aria-label={`Select ${r.vehicleNo || r.code}`}
                  title={other ? `One invoice goes to one client — ${pickedClient} is already selected.` : undefined}
                  disabled={other}
                  checked={!!picked[r.id]}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setPicked({ ...picked, [r.id]: e.target.checked })}
                />
              );
            },
          },
        ]
      : []),
    { key: 'trip', label: 'Trip', mono: true, render: (r) => r.code },
    { key: 'vehicle', label: 'Vehicle', mono: true, render: (r) => r.vehicleNo || '—' },
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    { key: 'lane', label: 'Route', render: (r) => r.lane },
    {
      key: 'stage',
      label: 'Where it is',
      render: (r) => (
        <Tag tone={r.stage === 'IN_TRANSIT' ? 'blue' : 'mint'}>
          {r.stage === 'IN_TRANSIT' ? 'In transit' : r.stage === 'DELIVERED' ? 'Delivered' : 'Closed'}
        </Tag>
      ),
    },
    { key: 'freight', label: 'Freight', align: 'right', render: (r) => inr(r.sellRatePaise) },
    {
      key: 'go',
      label: '',
      align: 'right',
      render: (r) =>
        can('invoice.create') ? (
          <Link
            className="btn btn-sm"
            href={`/invoices/new?${r.clientId ? `client=${r.clientId}&` : ''}trip=${r.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            Raise invoice
          </Link>
        ) : null,
    },
  ];

  const columns: Column<Invoice>[] = [
    {
      key: 'code',
      label: 'Bill',
      render: (r) => (
        <Link href={`/invoices/${r.id}`} className="mono" style={{ fontSize: 12 }}>
          {r.code ?? 'draft'}
        </Link>
      ),
    },
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    { key: 'date', label: 'Raised on', render: (r) => fmtDate(r.invoiceDate) },
    { key: 'due', label: 'Due by', render: (r) => fmtDate(r.dueDate) },
    { key: 'trips', label: 'Loads on this bill', align: 'right', render: (r) => r.tripIds.length },
    { key: 'total', label: 'Bill amount', align: 'right', render: (r) => inr(r.totalPaise) },
    { key: 'received', label: 'Paid so far', align: 'right', render: (r) => inr(r.receivedPaise) },
    { key: 'balance', label: 'Still owed', align: 'right', render: (r) => inr(r.totalPaise - r.receivedPaise) },
    { key: 'status', label: 'Status', render: (r) => <Tag tone={TONE[r.status]}>{r.status.replace(/_/g, ' ')}</Tag> },
  ];

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading the ledger" />;

  const open = rows.filter((r) => ['ISSUED', 'PART_PAID'].includes(r.status));

  return (
    <ModuleGuard module="invoices">
      <PageHeader
        path="/invoices"
        title="Client bills"
        sub="No tax is added to these invoices — the client is responsible for reporting and paying GST themselves."
        module="invoices"
        right={
          can('invoice.create') && (
            <Link href="/invoices/new" className="btn">
              New invoice
            </Link>
          )
        }
      />

      <PageIntro
        what="Every invoice raised to a client, what's been received against it, and what's still outstanding — search or filter by status to find one."
        who="Finance runs the invoice ledger here; only finance can raise a new invoice."
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Bills not yet paid', id: 'bills-open', emoji: '🧾', v: open.length },
            { k: 'Money owed to us', id: 'bills-open-value', emoji: '💰', v: inr(open.reduce((a, r) => a + (r.totalPaise - r.receivedPaise), 0)), tone: 'flag' },
            { k: 'Collected this period', id: 'bills-collected', emoji: '✅', v: rows.filter((r) => r.status === 'PAID').length, tone: 'mint' },
            { k: 'Cancelled bills', id: 'bills-cancelled', emoji: '⛔', v: rows.filter((r) => r.status === 'CANCELLED').length },
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

        {ready && ready.length > 0 && (
          <Panel title={`🧾 Ready to invoice · ${ready.length}`} pad={false}>
            <p className="muted" style={{ fontSize: 12.5, margin: 0, padding: '10px 14px 0' }}>
              Orders in transit or delivered that are not on a client invoice yet.
              {can('invoice.create') && ' Tick several loads of the same client to put them all on one invoice.'}
            </p>
            {pickedRows.length > 0 && (
              <div
                data-bulk-invoice
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  margin: '10px 14px 0',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-accent-tint)',
                }}
              >
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <strong>
                    {pickedRows.length} {pickedRows.length === 1 ? 'vehicle' : 'vehicles'} selected
                  </strong>{' '}
                  for {pickedClient} · <span className="mono">{inr(pickedRows.reduce((a, r) => a + r.sellRatePaise, 0))}</span>
                </div>
                {sameClient.length > pickedRows.length && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPicked(Object.fromEntries(sameClient.map((r) => [r.id, true])))}
                  >
                    Select all {sameClient.length} of {pickedClient}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setPicked({})}>
                  Clear
                </button>
                <Link
                  className="btn btn-sm"
                  href={`/invoices/new?${pickedRows[0].clientId ? `client=${encodeURIComponent(pickedRows[0].clientId)}&` : ''}trip=${pickedRows.map((r) => encodeURIComponent(r.id)).join(',')}`}
                >
                  {pickedRows.length === 1 ? 'Raise invoice for 1 vehicle' : `Raise one invoice for ${pickedRows.length} vehicles`}
                </Link>
              </div>
            )}
            <DataTable columns={readyColumns} rows={ready} rowKey={(r) => r.id} />
          </Panel>
        )}

        <div data-testid="invoice-ledger">
        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/invoices/${r.id}`)}
            empty={
              q || status ? (
                'No invoices match this search or status.'
              ) : (
                <EmptyState
                  title="No invoices raised yet"
                  hint="An invoice bills a client for one or more consignments that have been delivered. Raise the first one from a delivered, unbilled consignment."
                  action={
                    can('invoice.create') && (
                      <Link href="/invoices/new" className="btn">
                        New invoice
                      </Link>
                    )
                  }
                />
              )
            }
          />
        </Panel>
        </div>
      </Stack>
    </ModuleGuard>
  );
}
