'use client';

import { CSSProperties, ReactNode } from 'react';
import type { CompanyDetails } from '@/app/admin/types';
import type { ExtraCharge, InvoiceStatus } from '@/app/invoices/types';
import {
  INVOICE_BLUE,
  INVOICE_BRAND,
  INVOICE_EMAIL,
  INVOICE_NAVY,
  INVOICE_TAGLINE,
  INVOICE_WEBSITE,
  addressLines,
  addressOneLine,
  amount,
  companyExtraLines,
  invoiceStatus,
  isoDay,
} from '@/lib/invoice-layout';
import { invoiceTermsLines } from '@/lib/print-settings';
import { UpiQr } from './upi-qr';
import {
  type ManualDetails,
  amountInWords,
  gstState,
  liableParty,
  manualTotals,
  reverseChargeTax,
  stateOfGstin,
} from '@/lib/manual-invoice';

/** What the sheet needs — an `InvoiceDetail` built by hand, or the builder's live preview. */
export interface TaxInvoiceView {
  code: string | null;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate: string;
  manual: ManualDetails;
  extraCharges: ExtraCharge[];
  receivedPaise: number;
  notes: string;
  company: CompanyDetails;
}

const box: CSSProperties = { border: '1px solid #9aa3b5', padding: '7px 9px', verticalAlign: 'top' };
const label: CSSProperties = { fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: '#4a5468', fontWeight: 700, marginBottom: 3 };
const th: CSSProperties = { padding: '6px 7px', fontWeight: 700, color: '#fff', fontSize: 10.5, border: `1px solid ${INVOICE_NAVY}` };
const td: CSSProperties = { padding: '6px 7px', border: '1px solid #9aa3b5', verticalAlign: 'top' };
const num: CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6, lineHeight: 1.5 }}>
      <span style={{ color: '#4a5468', minWidth: 112 }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v || '—'}</span>
    </div>
  );
}

const stateWithCode = (name: string) => {
  const s = gstState(name);
  return s ? `${s.name} (${s.code})` : name || '—';
};

/**
 * A GST tax invoice for a manual invoice — the form a goods transport agency's
 * invoice takes under CGST Rules 46 and 54(3). Every block a GST officer or a
 * client's accounts team looks for is in its usual place: supplier and
 * recipient with GSTINs and state codes, number and dates, place of supply,
 * "Reverse charge: Yes", the consignment (consignor, consignee, truck, route,
 * goods, gross weight), lines with SAC, totals with the amount in words, the
 * GST the recipient pays and who that is, bank details, terms, declaration and
 * signature. Letterhead, colours and footer are the company's own, as on every
 * other invoice it prints.
 */
export function TaxInvoiceSheet({ invoice }: { invoice: TaxInvoiceView }) {
  const { company, manual: m } = invoice;
  const totals = manualTotals(m.items, invoice.extraCharges);
  const tax = reverseChargeTax(totals.subTotalPaise, m.rcmRatePct, company.gstin, m.placeOfSupply);
  const payer = liableParty(m);
  const supplierState = stateOfGstin(company.gstin);
  const status = invoiceStatus(invoice.status);
  const half = m.rcmRatePct / 2;
  const sac = (s?: string) => s || company.sac || '996511';

  return (
    <div
      className="sheet"
      data-tax-invoice
      style={{
        maxWidth: 780,
        margin: '0 auto 24px',
        background: '#fff',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 11,
        color: '#111',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    >
      {/* ---- letterhead ---- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px 10px' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/nexraah-logo-print.png" alt={`${INVOICE_BRAND} logo`} style={{ height: 84, width: 'auto' }} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 19, fontWeight: 700, color: INVOICE_NAVY, textTransform: 'uppercase' }}>{company.name}</div>
          <div style={{ fontSize: 10.5, marginTop: 2 }}>
            <strong style={{ color: INVOICE_BLUE }}>{INVOICE_BRAND}</strong> <em style={{ color: '#333' }}>{INVOICE_TAGLINE}</em>
          </div>
        </div>
      </div>
      <div style={{ borderTop: `4px solid ${INVOICE_NAVY}` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 2px' }}>
        <span style={{ fontSize: 10, color: '#4a5468' }}>Original for recipient</span>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '.12em', color: INVOICE_NAVY }}>TAX INVOICE</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: status.paid ? '#16803c' : invoice.status === 'CANCELLED' ? '#e03a3a' : '#4a5468' }}>{status.label}</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {/* ---- supplier | invoice details ---- */}
          <tr>
            <td style={{ ...box, width: '52%' }}>
              <div style={label}>Supplier</div>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{company.name}</div>
              {addressLines(company.address).map((l) => (
                <div key={l}>{l}</div>
              ))}
              <div style={{ marginTop: 3 }}>
                <b>GSTIN:</b> {company.gstin || '—'}
                {company.pan ? <> · <b>PAN:</b> {company.pan}</> : null}
              </div>
              {company.cin && (
                <div>
                  <b>CIN:</b> {company.cin}
                </div>
              )}
              <div>
                <b>State:</b> {supplierState ? `${supplierState.name} (${supplierState.code})` : '—'}
              </div>
              {companyExtraLines(company).map((l) => (
                <div key={l}>{l}</div>
              ))}
            </td>
            <td style={box}>
              <Fact k="Invoice number" v={invoice.code ?? 'DRAFT — not numbered yet'} />
              <Fact k="Invoice date" v={isoDay(invoice.invoiceDate)} />
              <Fact k="Due date" v={isoDay(invoice.dueDate)} />
              <Fact k="Place of supply" v={stateWithCode(m.placeOfSupply)} />
              <Fact k="Reverse charge" v="Yes" />
              {m.clientRef ? <Fact k="Client PO / ref." v={m.clientRef} /> : null}
              <Fact k="LR / GC note" v={[m.lrNo, m.lrDate ? isoDay(m.lrDate) : ''].filter(Boolean).join(' · ')} />
            </td>
          </tr>

          {/* ---- bill to | consignment parties ---- */}
          <tr>
            <td style={box}>
              <div style={label}>Bill to (recipient)</div>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{m.billTo.name}</div>
              {addressLines(m.billTo.address).map((l) => (
                <div key={l}>{l}</div>
              ))}
              <div style={{ marginTop: 3 }}>
                <b>GSTIN:</b> {m.billTo.gstin || 'Unregistered'}
              </div>
              <div>
                <b>State:</b> {stateWithCode(m.billTo.state)}
              </div>
            </td>
            <td style={box}>
              <div style={label}>Consignor</div>
              <div style={{ fontWeight: 700 }}>{m.consignor.name}</div>
              {m.consignor.address ? <div>{m.consignor.address}</div> : null}
              {m.consignor.gstin ? <div>GSTIN: {m.consignor.gstin}</div> : null}
              <div style={{ ...label, marginTop: 7 }}>Consignee</div>
              <div style={{ fontWeight: 700 }}>{m.consignee.name}</div>
              {m.consignee.address ? <div>{m.consignee.address}</div> : null}
              {m.consignee.gstin ? <div>GSTIN: {m.consignee.gstin}</div> : null}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ---- the consignment, Rule 54(3) ---- */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: -1 }}>
        <tbody>
          <tr>
            {(
              [
                ['Vehicle no.', m.vehicleNo],
                ['From', m.fromPlace],
                ['To', m.toPlace],
                ['Goods', m.goods],
                ['Packages', m.packages || '—'],
                ['Gross weight', `${Number(m.grossWeightKg).toLocaleString('en-IN')} kg`],
              ] as const
            ).map(([k, v]) => (
              <td key={k} style={box}>
                <div style={label}>{k}</div>
                <div style={{ fontWeight: 600 }}>{v}</div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {/* ---- lines ---- */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
        <thead>
          <tr style={{ background: INVOICE_NAVY }}>
            <th style={{ ...th, width: 28 }}>#</th>
            <th style={{ ...th, textAlign: 'left' }}>Description of service</th>
            <th style={{ ...th, width: 62 }}>SAC</th>
            <th style={{ ...th, width: 50, textAlign: 'right' }}>Qty</th>
            <th style={{ ...th, width: 44 }}>Unit</th>
            <th style={{ ...th, width: 88, textAlign: 'right' }}>Rate (₹)</th>
            <th style={{ ...th, width: 98, textAlign: 'right' }}>Taxable value (₹)</th>
          </tr>
        </thead>
        <tbody>
          {m.items.map((it, i) => (
            <tr key={i}>
              <td style={{ ...td, textAlign: 'center' }}>{i + 1}</td>
              <td style={td}>{it.description}</td>
              <td style={{ ...td, textAlign: 'center' }}>{sac(it.sac)}</td>
              <td style={num}>{Number(it.qty).toLocaleString('en-IN')}</td>
              <td style={{ ...td, textAlign: 'center' }}>{it.unit}</td>
              <td style={num}>{amount(it.ratePaise)}</td>
              <td style={num}>{amount(it.amountPaise)}</td>
            </tr>
          ))}
          {invoice.extraCharges.map((c, i) => (
            <tr key={`x${i}`}>
              <td style={{ ...td, textAlign: 'center' }}>{m.items.length + i + 1}</td>
              <td style={td}>{c.label}</td>
              <td style={{ ...td, textAlign: 'center' }}>{sac()}</td>
              <td style={num}>1</td>
              <td style={{ ...td, textAlign: 'center' }}>Nos</td>
              <td style={num}>{amount(c.amountPaise)}</td>
              <td style={num}>{amount(c.amountPaise)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={6} style={{ ...num, fontWeight: 700 }}>Total taxable value</td>
            <td style={{ ...num, fontWeight: 700 }}>{amount(totals.subTotalPaise)}</td>
          </tr>
          <tr>
            <td colSpan={6} style={num}>GST charged on this invoice (payable by the recipient under reverse charge)</td>
            <td style={num}>0.00</td>
          </tr>
          {totals.roundOffPaise !== 0 && (
            <tr>
              <td colSpan={6} style={num}>Round off</td>
              <td style={num}>{amount(totals.roundOffPaise)}</td>
            </tr>
          )}
          <tr style={{ background: '#eef1f7' }}>
            <td colSpan={6} style={{ ...num, fontWeight: 700, fontSize: 12.5 }}>Invoice total</td>
            <td style={{ ...num, fontWeight: 700, fontSize: 12.5 }} data-invoice-total>₹{amount(totals.totalPaise)}</td>
          </tr>
          {invoice.receivedPaise > 0 && (
            <tr>
              <td colSpan={6} style={num}>Received · amount due</td>
              <td style={num}>
                {amount(invoice.receivedPaise)} · {amount(totals.totalPaise - invoice.receivedPaise)}
              </td>
            </tr>
          )}
          <tr>
            <td colSpan={7} style={td}>
              <b>Amount in words:</b> <span data-amount-words>{amountInWords(totals.totalPaise)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ---- the GST the recipient pays ---- */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
        <thead>
          <tr style={{ background: '#e4e8f1' }}>
            {['SAC', 'Taxable value', `CGST ${tax.interState ? '' : `@${half}%`}`, `SGST ${tax.interState ? '' : `@${half}%`}`, `IGST ${tax.interState ? `@${m.rcmRatePct}%` : ''}`, 'Total GST'].map((h) => (
              <th key={h} style={{ ...td, fontSize: 10, fontWeight: 700, textAlign: h === 'SAC' ? 'left' : 'right' }}>
                {h.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={td}>{sac(m.items[0]?.sac)}</td>
            <td style={num}>{amount(totals.subTotalPaise)}</td>
            <td style={num}>{amount(tax.cgstPaise)}</td>
            <td style={num}>{amount(tax.sgstPaise)}</td>
            <td style={num}>{amount(tax.igstPaise)}</td>
            <td style={{ ...num, fontWeight: 700 }}>{amount(tax.taxPaise)}</td>
          </tr>
          <tr>
            <td colSpan={6} style={{ ...td, fontSize: 10.5 }}>
              <b>Tax payable on reverse charge: Yes.</b> The GST above is not charged on this invoice; it is paid by the{' '}
              {payer.role.toLowerCase()} — <b>{payer.name}</b>, GSTIN <b>{payer.gstin || '—'}</b> — under section 9(3) of the CGST Act.
            </td>
          </tr>
        </tbody>
      </table>

      {/* ---- bank, terms, signature ---- */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
        <tbody>
          <tr>
            <td style={{ ...box, width: '52%' }}>
              <div style={label}>Bank details</div>
              {String(company.bank ?? '')
                .split(/\s*[·|]\s*/)
                .filter(Boolean)
                .map((l) => (
                  <div key={l}>{l}</div>
                ))}
              <UpiQr amountPaise={totals.totalPaise - invoice.receivedPaise} invoiceCode={invoice.code} />
              {invoice.notes ? (
                <>
                  <div style={{ ...label, marginTop: 7 }}>Notes</div>
                  {invoice.notes.split(/\r?\n/).map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </>
              ) : null}
              {invoiceTermsLines(company).length > 0 && (
                <>
                  <div style={{ ...label, marginTop: 7 }}>Terms &amp; conditions</div>
                  {invoiceTermsLines(company).map((l, i) => (
                    <div key={i} style={{ fontSize: 10 }}>
                      {l}
                    </div>
                  ))}
                </>
              )}
            </td>
            <td style={{ ...box, display: 'table-cell' }}>
              <div style={{ fontSize: 10 }}>
                Certified that the particulars given above are true and correct, and that the amount shown is the actual price of the
                service described.
              </div>
              <div style={{ textAlign: 'right', marginTop: 10, fontWeight: 700 }}>For {company.name}</div>
              <div style={{ height: 46 }} />
              <div style={{ textAlign: 'right', borderTop: '1px solid #9aa3b5', paddingTop: 3 }}>{company.signatory || 'Authorised Signatory'}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 9.5, color: '#4a5468', textAlign: 'center', marginTop: 6 }}>This is a computer-generated invoice.</div>

      {/* ---- footer band ---- */}
      <div
        style={{
          marginTop: 8,
          background: INVOICE_NAVY,
          borderTop: `3px solid ${INVOICE_BLUE}`,
          color: '#fff',
          textAlign: 'center',
          padding: '8px 12px 9px',
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 11,
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
