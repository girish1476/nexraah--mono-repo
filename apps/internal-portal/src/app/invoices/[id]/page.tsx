'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { fmtDate, inr } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  Dialog,
  ErrorState,
  FactList,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Split,
  Tag,
  useCan,
  useToast,
} from '@/lib/ui';
import { cancelInvoice, generateInvoice, getInvoice } from '../apis';
import { InvoiceDetail, Receipt } from '../types';

/** Invoice detail — `/invoices/[id]`. Cancel keeps the row, the number and a reason. */
export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const toast = useToast();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    getInvoice(id).then(setInvoice).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  const issue = async () => {
    setBusy(true);
    try {
      const issued = await generateInvoice(id);
      toast(`${issued.code} issued`);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelInvoice(id, reason);
      toast('Cancelled · the number and the row are kept');
      setCancelOpen(false);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!invoice) return <Loading what="Loading the invoice" />;

  const balance = invoice.totalPaise - invoice.receivedPaise;

  const receiptColumns: Column<Receipt>[] = [
    { key: 'code', label: 'Receipt', mono: true, render: (r) => r.code },
    { key: 'when', label: 'Received', render: (r) => fmtDate(r.receivedOn) },
    { key: 'mode', label: 'Mode', render: (r) => r.mode },
    { key: 'ref', label: 'UTR / cheque', mono: true, render: (r) => r.reference },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amountPaise) },
  ];

  return (
    <ModuleGuard module="invoices">
      <PageHeader
        path={`/invoices/${invoice.code ?? 'draft'}`}
        title={invoice.code ?? 'Draft invoice'}
        sub={`${invoice.clientName} · ${fmtDate(invoice.invoiceDate)}`}
        module="invoices"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {invoice.code && (
              <Link href={`/print/invoice/${invoice.id}`} className="btn btn-secondary" target="_blank">
                Print four copies
              </Link>
            )}
            {!invoice.code && can('invoice.create') && (
              <button className="btn" onClick={issue} disabled={busy}>
                Generate invoice
              </button>
            )}
            {invoice.code && invoice.status !== 'CANCELLED' && can('invoice.create') && (
              <button className="btn btn-secondary" onClick={() => setCancelOpen(true)}>
                Cancel
              </button>
            )}
          </div>
        }
      />

      <Split
        aside={
          <>
            <Panel title="Invoice" pad={false}>
              <FactList
                facts={[
                  ['Number', invoice.code ?? 'not issued'],
                  ['Client', invoice.clientName],
                  ['Invoice date', fmtDate(invoice.invoiceDate)],
                  ['Due date', fmtDate(invoice.dueDate)],
                  ['Status', <Tag key="s" tone={invoice.status === 'PAID' ? 'mint' : 'grey'}>{invoice.status}</Tag>],
                  ['Value', inr(invoice.totalPaise)],
                  ['Received', inr(invoice.receivedPaise)],
                  ['Balance', inr(balance)],
                ]}
              />
            </Panel>
            <Panel title="Tax">
              <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                <strong>GST payable by recipient under reverse charge</strong>
                <div className="muted">Section 9(3), CGST Act 2017. No tax has been charged on this invoice.</div>
              </div>
            </Panel>
          </>
        }
      >
        {invoice.status === 'CANCELLED' && (
          <Banner tone="red" title="Cancelled">
            {invoice.cancelReason}. The row and its number are kept — an invoice is never deleted.
          </Banner>
        )}

        <Panel title="Charges" pad={false}>
          <div style={{ padding: '12px 15px', display: 'grid', gap: 4, maxWidth: 420 }}>
            <Line label="Freight" value={invoice.freightPaise} />
            <Line label="Loading" value={invoice.loadingPaise} />
            <Line label="Unloading" value={invoice.unloadingPaise} />
            <Line label="Detention" value={invoice.detentionPaise} />
            <Line label="Other" value={invoice.otherPaise} />
            <Line label="Discount" value={-invoice.discountPaise} />
            <Line label="Round off" value={invoice.roundOffPaise} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid var(--color-divider)',
                paddingTop: 6,
                fontWeight: 600,
              }}
            >
              <span>Total</span>
              <span className="mono" style={{ fontSize: 17 }}>
                {inr(invoice.totalPaise)}
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Consignments" pad={false}>
          <DataTable
            columns={[
              { key: 'code', label: 'Trip', mono: true, render: (t) => t.code },
              { key: 'lr', label: 'LR', mono: true, render: (t) => t.lrCode ?? '—' },
              { key: 'lane', label: 'Lane', render: (t) => t.lane },
              { key: 'delivered', label: 'Delivered', render: (t) => fmtDate(t.deliveredAt) },
              { key: 'freight', label: 'Freight', align: 'right', render: (t) => inr(t.sellRatePaise) },
            ]}
            rows={invoice.trips}
            rowKey={(t) => t.id}
          />
        </Panel>

        <Panel title="Receipts" pad={false}>
          <DataTable columns={receiptColumns} rows={invoice.receipts} rowKey={(r) => r.id} empty="Nothing received yet." />
        </Panel>
      </Split>

      <Dialog
        open={cancelOpen}
        title="Cancel this invoice"
        body="A cancelled invoice keeps its number and its reason. Nothing is deleted."
        confirmLabel="Cancel invoice"
        confirmDisabled={!reason.trim()}
        busy={busy}
        onConfirm={cancel}
        onClose={() => setCancelOpen(false)}
      >
        <Field label="Reason" required>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span>{label}</span>
      <span className="mono">{inr(value)}</span>
    </div>
  );
}
