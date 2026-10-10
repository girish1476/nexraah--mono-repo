'use client';

import { CSSProperties, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { getInvoice } from '@/app/invoices/apis';
import { InvoiceDetail } from '@/app/invoices/types';
import {
  INVOICE_BLUE,
  INVOICE_BRAND,
  INVOICE_EMAIL,
  INVOICE_NAVY,
  INVOICE_TAGLINE,
  INVOICE_TERMS,
  INVOICE_WEBSITE,
  addressLines,
  addressOneLine,
  amount,
  billToLines,
  companyExtraLines,
  invoiceLines,
  invoiceStatus,
  invoiceTotals,
  isoDay,
  lrNumbers,
  noteLines,
} from '@/lib/invoice-layout';
import { ErrorState, Loading } from '@/lib/ui';

/**
 * Printed invoice — `/print/invoice/[invoiceId]` (part 08 §2.1).
 *
 * A single copy — this is the bill Finance sends to the client. It is laid
 * out as the company's own invoice is: the letterhead (logo, company name,
 * brand line, and INVOICE with its number and whether it is paid — all above
 * the rule), who is billing
 * whom, one table of items, the totals, how to pay, the reverse-charge note,
 * terms, a signature line, and the footer band with the website and address.
 *
 * What it says comes from `lib/invoice-layout.ts`, shared with the downloaded
 * PDF, so the two cannot disagree. No tax is charged on it: the Tax column is
 * 0% and the note says the client pays GST under reverse charge.
 *
 * It is one page: the blocks sit close enough that an invoice for a load or two
 * ends above the foot of an A4 sheet.
 */
export default function PrintInvoicePage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getInvoice(invoiceId).then(setInvoice).catch((e) => setError(errorMessage(e)));
  }, [invoiceId]);

  if (error) return <ErrorState message={error} />;
  if (!invoice) return <Loading what="Preparing the invoice" />;

  return (
    <div style={{ background: '#fff', color: '#000', padding: 20 }}>
      <div className="no-print" style={{ marginBottom: 14, display: 'flex', gap: 8 }}>
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
        <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
          A4 · switch on “Background graphics” in the print dialog so the dark header row and footer print
        </span>
      </div>

      <Sheet invoice={invoice} />
    </div>
  );
}

const cell: CSSProperties = { padding: '9px 10px', verticalAlign: 'top' };
const head: CSSProperties = { padding: '8px 10px', fontWeight: 400, color: '#fff' };

function Sheet({ invoice }: { invoice: InvoiceDetail }) {
  const { company } = invoice;
  const status = invoiceStatus(invoice.status);
  const lines = invoiceLines(invoice);
  const totals = invoiceTotals(invoice);
  const total = (label: string, paise: number, band: boolean) => (
    <tr style={band ? { background: '#efefef' } : undefined}>
      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>{label}</td>
      <td style={{ padding: '6px 10px', textAlign: 'right', width: 130 }}>₹{amount(paise)}</td>
    </tr>
  );

  return (
    <div
      className="sheet"
      style={{
        maxWidth: 780,
        margin: '0 auto',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 12,
        color: '#111',
        // The header row and the footer band are backgrounds; without this a
        // browser drops them on paper unless "Background graphics" is ticked.
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    >
      {/* ---- letterhead ---- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px 12px' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/nexraah-logo-print.png" alt={`${INVOICE_BRAND} logo`} style={{ height: 116, width: 'auto' }} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 21, fontWeight: 700, color: INVOICE_NAVY, textTransform: 'uppercase' }}>{company.name}</div>
          <div style={{ fontSize: 11, marginTop: 3 }}>
            <strong style={{ color: INVOICE_BLUE }}>{INVOICE_BRAND}</strong>{' '}
            <em style={{ color: '#333' }}>{INVOICE_TAGLINE}</em>
          </div>
          {/* INVOICE, its number, and whether it is paid — part of the letterhead, above the rule. */}
          <div data-invoice-title style={{ marginTop: 12 }}>
            <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '.02em', lineHeight: 1.1 }}>INVOICE</div>
            <div style={{ fontWeight: 700, fontSize: 11.5 }}># {invoice.code ?? 'DRAFT'}</div>
            <div style={{ fontSize: 11.5, color: status.paid ? '#16803c' : '#e03a3a' }}>{status.label}</div>
          </div>
        </div>
      </div>
      <div data-invoice-rule style={{ borderTop: `4px solid ${INVOICE_NAVY}` }} />
      <div style={{ borderTop: `1px solid ${INVOICE_BLUE}`, marginTop: 10 }} />

      {/* ---- who is billing whom ---- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '18px 14px 0', lineHeight: 1.45 }}>
        <div data-company-block style={{ maxWidth: '52%' }}>
          <div style={{ fontWeight: 700 }}>{company.name}</div>
          {addressLines(company.address).map((line) => (
            <div key={line}>{line}</div>
          ))}
          <div>GST Number: {company.gstin}</div>
          {companyExtraLines(company).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
        <div style={{ textAlign: 'right', maxWidth: '46%' }}>
          <div style={{ fontWeight: 700 }}>Bill To:</div>
          <div style={{ fontWeight: 700 }}>{invoice.clientName}</div>
          {billToLines(invoice).map((line) => (
            <div key={line}>{line}</div>
          ))}
          <div style={{ marginTop: 8 }}>Invoice Date: {isoDay(invoice.invoiceDate)}</div>
          <div>Due Date: {isoDay(invoice.dueDate)}</div>
          {/* A load that is not a full truck load carries its own SAC, set on the edit screen; otherwise the company's. */}
          <div>SAC Code: {invoice.sacCode || company.sac}</div>
          <div>LR Number: {lrNumbers(invoice)}</div>
        </div>
      </div>

      {/* ---- the items ---- */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 20 }}>
        <thead>
          <tr style={{ background: INVOICE_NAVY }}>
            <th style={{ ...head, textAlign: 'left', width: 30 }}>#</th>
            <th style={{ ...head, textAlign: 'left' }}>Item</th>
            <th style={{ ...head, textAlign: 'center', width: 60 }}>Qty</th>
            <th style={{ ...head, textAlign: 'right', width: 110 }}>Rate</th>
            <th style={{ ...head, textAlign: 'center', width: 60 }}>Tax</th>
            <th style={{ ...head, textAlign: 'right', width: 110 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.title}-${i}`}>
              <td style={{ ...cell, fontWeight: 700 }}>{i + 1}</td>
              <td style={cell}>
                <div style={{ fontWeight: 700 }}>{l.title}</div>
                {l.sub.map((s) => (
                  <div key={s} style={{ fontSize: 11, color: '#333' }}>
                    {s}
                  </div>
                ))}
              </td>
              <td style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>{l.qty}</td>
              <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{amount(l.amountPaise)}</td>
              <td style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>0%</td>
              <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{amount(l.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---- totals ---- */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 18 }}>
        <tbody>
          {total('Sub Total', totals.subTotalPaise, false)}
          {totals.roundOffPaise !== 0 && total('Round Off', totals.roundOffPaise, false)}
          {total('Total', totals.totalPaise, true)}
          {totals.receivedPaise > 0 && total('Amount Received', totals.receivedPaise, false)}
          {total('Amount Due', totals.duePaise, true)}
        </tbody>
      </table>

      {/* ---- how to pay, the note, the terms ---- */}
      <div style={{ padding: '18px 14px 0', lineHeight: 1.45 }}>
        <div style={{ fontWeight: 700 }}>Offline Payment:</div>
        <div>Bank Transfer</div>

        <div style={{ fontWeight: 700, marginTop: 10 }}>Note:</div>
        {noteLines(invoice).map((line, i) => (
          <div key={i}>{line}</div>
        ))}

        <div style={{ fontWeight: 700, marginTop: 10 }}>Terms &amp; Conditions:</div>
        <div>{INVOICE_TERMS}</div>

        <div style={{ marginTop: 32 }}>Authorized Signature _________________________</div>
      </div>

      {/* ---- footer band ---- */}
      <div
        style={{
          marginTop: 22,
          background: INVOICE_NAVY,
          borderTop: `3px solid ${INVOICE_BLUE}`,
          color: '#fff',
          textAlign: 'center',
          padding: '9px 12px 11px',
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 11.5,
        }}
      >
        <div style={{ fontWeight: 700 }}>
          {INVOICE_WEBSITE} <span style={{ color: INVOICE_BLUE, margin: '0 14px' }}>|</span> {INVOICE_EMAIL}
        </div>
        <div style={{ marginTop: 2 }}>{addressOneLine(company.address)}</div>
      </div>
    </div>
  );
}
