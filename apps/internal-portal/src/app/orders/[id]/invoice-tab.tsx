'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { getInvoice } from '@/app/invoices/apis';
import type { InvoiceDetail, InvoiceStatus } from '@/app/invoices/types';
import { fmtDate, inr } from '@/lib/format';
import { EmptyState, ErrorState, FactList, Loading, Panel, Stack, Tag, useCan } from '@/lib/ui';
import type { OrderDetail } from '../types';

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft — not issued yet',
  ISSUED: 'Issued — awaiting payment',
  PART_PAID: 'Part paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

const STATUS_TONE: Record<InvoiceStatus, 'mint' | 'flag' | 'red' | 'blue' | 'grey'> = {
  DRAFT: 'grey',
  ISSUED: 'blue',
  PART_PAID: 'flag',
  PAID: 'mint',
  CANCELLED: 'red',
};

/**
 * The Invoice tab of `/orders/[id]` — the client's side of this order's money.
 *
 * Replaces the old Payments tab, which repeated the advance and final payment
 * already shown on Details. What the order page was missing was the other
 * half: what we bill the client for this load, whether it has gone out, and
 * whether they have paid. That is this tab.
 */
export function OrderInvoiceTab({ order }: { order: OrderDetail }) {
  const can = useCan();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!order.invoiceId) return;
    setError(null);
    getInvoice(order.invoiceId).then(setInvoice).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [order.invoiceId]);

  if (!order.invoiceId) {
    const delivered = ['UNLOADED', 'POD_UPLOADED', 'POD_VERIFIED', 'BALANCE_RELEASED', 'POD_FORFEITED'].includes(order.status);
    return (
      <Panel title="🧾 Client invoice">
        <EmptyState
          title="Not invoiced yet"
          hint={
            delivered
              ? `This load is delivered and can be billed to ${order.clientName}. The freight is ${inr(order.sellRatePaise)}, plus any charges billed on the trip.`
              : `The client is invoiced once the load is delivered. The freight agreed is ${inr(order.sellRatePaise)}.`
          }
        />
        {delivered && order.tripId && can('invoice.create') && (
          <div style={{ padding: '0 15px 15px' }}>
            <Link
              className="btn"
              href={`/invoices/new?client=${encodeURIComponent(order.clientId)}&trip=${encodeURIComponent(order.tripId)}`}
            >
              Raise the client invoice
            </Link>
          </div>
        )}
      </Panel>
    );
  }

  if (error) return <ErrorState message={error} retry={load} />;
  if (!invoice) return <Loading what="Loading the invoice" />;

  const outstanding = invoice.status === 'CANCELLED' ? 0 : invoice.totalPaise - invoice.receivedPaise;
  return (
    <Stack>
      <Panel
        title={`🧾 Invoice ${invoice.code ?? '(draft)'}`}
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Tag tone={STATUS_TONE[invoice.status]}>{STATUS_LABEL[invoice.status]}</Tag>
            <Link className="btn btn-secondary btn-sm" href={`/invoices/${invoice.id}`}>
              Open invoice
            </Link>
          </div>
        }
        pad={false}
      >
        <FactList
          facts={[
            ['Billed to', invoice.clientName],
            ['Invoice date', fmtDate(invoice.invoiceDate)],
            ['Due date', fmtDate(invoice.dueDate)],
            ['Freight', inr(invoice.freightPaise)],
            ...(invoice.loadingPaise ? ([['Loading', inr(invoice.loadingPaise)]] as [string, string][]) : []),
            ...(invoice.unloadingPaise ? ([['Unloading', inr(invoice.unloadingPaise)]] as [string, string][]) : []),
            ...(invoice.detentionPaise ? ([['Detention', inr(invoice.detentionPaise)]] as [string, string][]) : []),
            ...(invoice.otherPaise ? ([['Other', inr(invoice.otherPaise)]] as [string, string][]) : []),
            ...(invoice.extraCharges ?? []).map((c): [string, string] => [c.label, inr(c.amountPaise)]),
            ...(invoice.discountPaise ?([['Discount', `− ${inr(invoice.discountPaise)}`]] as [string, string][]) : []),
            ['Invoice total', <strong key="t">{inr(invoice.totalPaise)}</strong>],
            ['Received so far', inr(invoice.receivedPaise)],
            [
              'Still to collect',
              <strong key="o" style={{ color: outstanding > 0 ? 'var(--flag)' : undefined }}>
                {inr(outstanding)}
              </strong>,
            ],
          ]}
        />
        {invoice.tripIds.length > 1 && (
          <div className="hint" style={{ padding: '10px 14px' }}>
            This invoice covers {invoice.tripIds.length} loads for {invoice.clientName}, this one among them.
          </div>
        )}
      </Panel>

      <Panel title="💰 Money received from the client" pad={false}>
        {invoice.receipts.length === 0 ? (
          <div className="hint" style={{ padding: 15 }}>
            Nothing received yet. Receipts are recorded against the invoice under Receivables.
          </div>
        ) : (
          <FactList
            facts={invoice.receipts.map(
              (r) => [`${fmtDate(r.receivedOn)} · ${r.mode}`, `${inr(r.amountPaise)} · ref ${r.reference}`] as [string, string],
            )}
          />
        )}
      </Panel>
    </Stack>
  );
}
