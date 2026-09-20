'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { getInvoice } from '@/app/invoices/apis';
import { InvoiceDetail } from '@/app/invoices/types';
import { Barcode } from '@/components/barcode';
import { fmtDate, inr } from '@/lib/format';
import { ErrorState, Loading } from '@/lib/ui';

/**
 * Printed invoice — `/print/invoice/[invoiceId]` (part 08 §2.1).
 *
 * A single copy — this is the bill Finance sends to the client, not a
 * document that travels with the goods, so there's nothing for a second
 * party to countersign and keep. (The lorry receipt is the multi-copy,
 * multi-signature document — see `/print/lr/[tripId]`.) Carries the company
 * block, the charge table across the six heads, the reverse-charge
 * declaration, terms, a barcode of the invoice number and an
 * authorised-signature block. There is no tax line anywhere.
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
          A4
        </span>
      </div>

      <Copy invoice={invoice} />
    </div>
  );
}

function Copy({ invoice }: { invoice: InvoiceDetail }) {
  const heads: [string, number][] = [
    ['Freight', invoice.freightPaise],
    ['Loading', invoice.loadingPaise],
    ['Unloading', invoice.unloadingPaise],
    ['Detention', invoice.detentionPaise],
    ['Other', invoice.otherPaise],
    ['Discount', -invoice.discountPaise],
  ];

  return (
    <div
      className="sheet"
      style={{
        maxWidth: 780,
        margin: '0 auto',
        border: '1px solid #000',
        padding: 16,
        fontFamily: 'var(--font-body)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Watermark />

      {/* Everything below sits above the watermark by DOM order alone — a
          static sibling always paints over an absolutely-positioned earlier
          one in the same stacking context — but the explicit z-index makes
          that not an accident anyone has to know to preserve. */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 10 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22 }}>{invoice.company.name}</div>
            <div style={{ fontSize: 11 }}>{invoice.company.address}</div>
            <div style={{ fontSize: 11 }}>
              GSTIN {invoice.company.gstin} · PAN {invoice.company.pan} · CIN {invoice.company.cin}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase' }}>Tax invoice</div>
            <div className="mono" style={{ fontSize: 17 }}>
              {invoice.code ?? 'DRAFT'}
            </div>
            <div style={{ fontSize: 11 }}>
              Dated {fmtDate(invoice.invoiceDate)} · due {fmtDate(invoice.dueDate)}
            </div>
            {/* SAC — the GST service code for a goods transport agency's road
                transport service (996511). A tax invoice for a service is
                required to carry it, the same way a goods invoice carries an
                HSN code. */}
            <div style={{ fontSize: 11 }}>SAC {invoice.company.sac}</div>
            {invoice.code && (
              <div style={{ marginTop: 4 }}>
                <Barcode value={invoice.code} height={30} />
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '8px 0', borderBottom: '1px solid #000' }}>
          <div style={{ fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Billed to</div>
          <div>{invoice.clientName}</div>
          <div style={{ fontSize: 11 }}>
            {invoice.client?.billingCity} · GSTIN {invoice.client?.gstin ?? '—'}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 8 }}>
          <thead>
            <tr>
              {['LR', 'Trip', 'Lane', 'Delivered', 'Freight'].map((h) => (
                <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #000', padding: '5px 4px', fontSize: 10 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoice.trips.map((t) => (
              <tr key={t.id}>
                <td style={{ padding: '4px' }}>{t.lrCode ?? '—'}</td>
                <td style={{ padding: '4px' }}>{t.code}</td>
                <td style={{ padding: '4px' }}>{t.lane}</td>
                <td style={{ padding: '4px' }}>{fmtDate(t.deliveredAt)}</td>
                <td style={{ padding: '4px', textAlign: 'right' }}>{inr(t.sellRatePaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <table style={{ fontSize: 11.5, minWidth: 260 }}>
            <tbody>
              {heads.map(([label2, value]) => (
                <tr key={label2}>
                  <td style={{ padding: '2px 8px' }}>{label2}</td>
                  <td style={{ padding: '2px 8px', textAlign: 'right' }} className="mono">
                    {inr(value)}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: '2px 8px' }}>Round off</td>
                <td style={{ padding: '2px 8px', textAlign: 'right' }} className="mono">
                  {inr(invoice.roundOffPaise)}
                </td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px', borderTop: '1px solid #000', fontWeight: 700 }}>Total</td>
                <td style={{ padding: '4px 8px', borderTop: '1px solid #000', textAlign: 'right', fontWeight: 700 }} className="mono">
                  {inr(invoice.totalPaise)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ border: '1px solid #000', padding: '6px 8px', marginTop: 10, fontSize: 10.5 }}>
          <strong>GST PAYABLE BY RECIPIENT UNDER REVERSE CHARGE</strong>
          <div>Section 9(3), CGST Act 2017. No tax has been charged on this invoice.</div>
        </div>

        <div style={{ fontSize: 9.5, marginTop: 8, lineHeight: 1.45 }}>
          <strong>Terms.</strong> Payment is due within the agreed credit period from the invoice date. Interest may
          be charged on overdue amounts. Any discrepancy must be notified in writing within seven days of receipt of
          this invoice. Bank details: {invoice.company.bank}.
        </div>

        {/* "For {company}" above a blank space left for a pen signature, the
            title below a rule under it — the standard layout for an Indian
            tax invoice's signature block. The title (default "Authorised
            Signatory") is `config.company.signatory`, editable from
            `/admin` — added because it used to be fixed text with no field
            behind it, so there was no way to name a specific signatory. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 24 }}>
          <div style={{ minWidth: 200, textAlign: 'center' }}>
            <div style={{ fontSize: 10.5 }}>For {invoice.company.name}</div>
            <div style={{ borderTop: '1px solid #000', marginTop: 34, paddingTop: 4, fontSize: 10 }}>
              {invoice.company.signatory}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A faint centred logo behind the whole sheet, so a page torn loose from its
 * other pages, or a photocopy of one, is still recognisably Nexraah's.
 *
 * `public/logo.png` is a solid navy square, not a logo cut out on
 * transparency — dropping it in at low opacity as-is would print as a pale
 * grey box, not a watermark. `invert(1)` flips it to a near-white square
 * with a dark mark, and `multiply` blended onto the sheet's own white
 * disappears that near-white square into the page while leaving the dark
 * mark as a faint tint — the standard way to fake a transparent watermark
 * from a logo that was only ever exported on its brand colour. `grayscale(1)`
 * runs first: without it, the logo's light-blue swoosh inverts to an orange
 * smudge rather than a neutral grey one, which reads as a printing fault
 * rather than a watermark — every other letterhead watermark on record is
 * monochrome for the same reason. It's a real rendered image, not a CSS
 * background, so it survives printing even with a browser's "background
 * graphics" print option left off — that setting only suppresses
 * `background-color`/`background-image`.
 */
function Watermark() {
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 360,
        height: 360,
        opacity: 0.07,
        filter: 'grayscale(1) invert(1)',
        mixBlendMode: 'multiply',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
