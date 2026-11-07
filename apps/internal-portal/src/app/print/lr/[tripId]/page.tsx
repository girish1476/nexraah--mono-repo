'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { getConfig } from '@/app/admin/apis';
import { Config } from '@/app/admin/types';
import { getTrip } from '@/app/trips/apis';
import { FREIGHT_TERMS_LABEL, TripDetail, lrChargesTotal } from '@/app/trips/types';
import { Barcode } from '@/components/barcode';
import { fmtDate, fmtDateTime, inr } from '@/lib/format';
import { partyState } from '@/lib/gst-state';
import { lrCopies, lrTermsLines, termsSections } from '@/lib/print-settings';
import { ErrorState, Loading } from '@/lib/ui';

/**
 * Printed lorry receipt — `/print/lr/[tripId]` (part 05 §5.1, FSD B6, BR-17).
 *
 * Laid out as the company's own LR book (Nexus Freight, Nov 2026): each copy is
 * a front and a back. The front carries the booking — consignor and consignee
 * with GSTIN and state, invoice and e-way bill, the goods with actual and
 * charged weight, truck and gate times, how loading is charged, whether the
 * freight is paid, to be billed or to pay, halting days, closed or open body
 * and the loading supervisor. The back is the "Unloading Purpose" block, filled
 * in by hand at the destination and signed by the consignee, then the terms.
 *
 * Copy names and terms are the company's to word (Admin → Control panel →
 * Printed documents); until set, the book's four copies and its terms print.
 * What is not known when the receipt is printed is left as a line to write on,
 * as on the paper.
 */

const INK = '#1d3a8a';

export default function PrintLrPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getTrip(tripId), getConfig()])
      .then(([t, c]) => {
        setTrip(t);
        setConfig(c);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [tripId]);

  if (error) return <ErrorState message={error} />;
  if (!trip || !config) return <Loading what="Preparing the lorry receipt" />;

  const copies = lrCopies(config.company);

  return (
    <div style={{ background: '#fff', color: '#000', padding: 20, fontFamily: 'var(--font-body)' }}>
      <div className="no-print" style={{ marginBottom: 14, display: 'flex', gap: 8 }}>
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
        <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
          {copies.length} {copies.length === 1 ? 'copy' : 'copies'}, front and back · A4 · print both sides
        </span>
      </div>

      {copies.map((copy) => (
        <div key={copy}>
          <Front label={copy} trip={trip} config={config} />
          <Back trip={trip} config={config} />
        </div>
      ))}
    </div>
  );
}

function Header({ label, trip, config }: { label: string; trip: TripDetail; config: Config }) {
  const lr = trip.lr;
  const c = config.company;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 170px', borderBottom: `1.5px solid ${INK}` }}>
      <div style={{ padding: 6, borderRight: `1px solid ${INK}`, textAlign: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/nexraah-logo-print.png" alt="Nexraah" style={{ width: 74, height: 'auto' }} />
        <div style={{ fontSize: 10, fontWeight: 700, color: INK, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      </div>
      <div style={{ padding: '6px 10px', textAlign: 'center', borderRight: `1px solid ${INK}` }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 24, color: INK, textTransform: 'uppercase', lineHeight: 1.1 }}>
          {c.name}
        </div>
        <div style={{ fontSize: 11, color: INK }}>Reg Office: {c.address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(', ')}</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: INK }}>GSTIN: {c.gstin}</div>
      </div>
      <div style={{ fontSize: 11, color: INK }}>
        <div style={{ padding: '4px 6px', borderBottom: `1px solid ${INK}` }}>
          Mail ID: <span style={{ color: '#000' }}>{c.email || ''}</span>
        </div>
        <div style={{ padding: '4px 6px', borderBottom: `1px solid ${INK}` }}>
          LR No: <span className="mono" style={{ color: '#b91c1c', fontSize: 14, fontWeight: 700 }}>{lr?.code ?? 'DRAFT'}</span>
        </div>
        <div style={{ padding: '4px 6px' }}>
          Date: <span style={{ color: '#000' }}>{lr?.lrDate ? fmtDate(lr.lrDate) : ''}</span>
        </div>
      </div>
    </div>
  );
}

function Front({ label, trip, config }: { label: string; trip: TripDetail; config: Config }) {
  const lr = trip.lr;
  const heads = lr?.chargeHeads;
  const [from, to] = trip.lane.split('→').map((s) => s.trim());
  const total = lrChargesTotal(heads);
  const terms = heads?.freightTerms || '';
  const weight = lr?.goods?.weightTn;
  const charged = lr?.goods?.chargedWeightTn || weight;

  return (
    <div className="sheet lr-sheet" style={sheet}>
      <Header label={label} trip={trip} config={config} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', alignItems: 'center', padding: '8px 10px 0' }}>
        <div>{lr?.code && <Barcode value={lr.code} height={30} narrow={1.3} />}</div>
        <div style={{ border: `1px solid ${INK}` }}>
          <Line label="From" value={from} boxed />
          <Line label="To" value={to} boxed last />
        </div>
      </div>

      <Party title="Consignor" party={lr?.consignor} />
      <Party title="Consignee" party={lr?.consignee} />

      <div style={{ padding: '0 10px' }}>
        <Pair left={<Line label="Invoice No" value={lr?.invoice?.number} />} right={<Line label="Invoice Value" value={lr?.invoice?.valuePaise ? inr(lr.invoice.valuePaise) : ''} />} />
        <Pair left={<Line label="E Way Bill No" value={lr?.eway?.number} />} right={<Line label="Transit Days" value={lr?.transitDays || trip.transitDaysRequired || ''} />} />
      </div>

      <table style={{ width: 'calc(100% - 20px)', margin: '8px 10px', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <thead>
          <tr>
            {['Packages', 'Material Description', 'Actual Weight', 'Charged Weight'].map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
            <th style={{ ...th, textAlign: 'left' }}>
              Truck No: <span style={{ color: '#000', fontWeight: 600 }}>{lr?.vehicle?.registration || trip.vehicleNo}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...td, textAlign: 'center' }}>{lr?.goods?.packages || ''}</td>
            <td style={td}>{lr?.goods?.description}</td>
            <td style={{ ...td, textAlign: 'center' }}>{weight ? `${weight} MT` : ''}</td>
            <td style={{ ...td, textAlign: 'center' }}>{charged ? `${charged} MT` : ''}</td>
            <td style={{ ...td, height: 64, color: INK, verticalAlign: 'top' }}>
              <div>
                Gate In / Time: <span style={{ color: '#000' }}>{trip.reachedLoadingAt ? fmtDateTime(trip.reachedLoadingAt) : ''}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                Gate Out / Time: <span style={{ color: '#000' }}>{trip.departedAt ? fmtDateTime(trip.departedAt) : ''}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '4px 10px 10px', fontSize: 12, color: INK }}>
        <div>
          <div style={{ fontWeight: 700 }}>
            Loading Charges <Choice options={[['PER_TON', 'per Ton'], ['FIXED', 'Fixed']]} chosen={heads?.loadingBasis} />:{' '}
            <span style={{ color: '#000', fontWeight: 400 }}>{heads?.loadingPaise ? inr(heads.loadingPaise) : '________'}</span>
          </div>
          <table style={{ marginTop: 8, borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Paid / To Be Billed</th>
                <th style={th}>To Pay</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...td, height: 30, textAlign: 'center' }}>
                  {(terms === 'PAID' || terms === 'TO_BE_BILLED') && total > 0 ? `${inr(total)} · ${FREIGHT_TERMS_LABEL[terms]}` : ''}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>{terms === 'TO_PAY' && total > 0 ? inr(total) : ''}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ display: 'grid', gap: 8, fontWeight: 700 }}>
          <div>
            Loading Halting Days: <span style={{ color: '#000', fontWeight: 400 }}>{heads?.loadingHaltingDays ? heads.loadingHaltingDays : '________'}</span>
          </div>
          <div>
            Vehicle Type: <Choice options={[['CLOSED', 'Closed'], ['OPEN', 'Open']]} chosen={lr?.vehicle?.body} />
          </div>
          <div>
            Loading Supervisor Name:{' '}
            <span style={{ color: '#000', fontWeight: 400 }}>{trip.loadingSupervisorName ?? ''}</span>
            <div style={{ fontWeight: 400, fontSize: 11 }}>(Internal Purpose)</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Back({ trip, config }: { trip: TripDetail; config: Config }) {
  const sections = termsSections(lrTermsLines(config.company));
  return (
    <div className="sheet lr-sheet" style={sheet}>
      <div style={{ padding: '8px 12px' }}>
        <div style={{ textAlign: 'center', fontWeight: 700, color: INK, textDecoration: 'underline', fontSize: 13 }}>Unloading Purpose</div>
        <Pair left={<Line label="Truck No" value={trip.lr?.vehicle?.registration || trip.vehicleNo} />} right={<Line label="Report Date/Time" />} />
        <Pair left={<Line label="Unloading Charges (Hamali)" />} right={<Line label="Unloading Date / Time" />} />
        <Pair left={<Line label="No. of Halting Days" />} right={<Line label="Halting Amount" />} />
        <Pair left={<Line label="No. of Material Received" />} right={<Line label="Trans Shipment Vehicle Number" />} />
        <div style={{ fontWeight: 700, color: INK, textDecoration: 'underline', fontSize: 12.5, marginTop: 6 }}>Unloading Remarks:</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: '65%' }}>Damage / Leakage / Shortage / Material Interchange</th>
              <th style={th}>Consignee Sign / Stamp</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...td, height: 110 }} />
              <td style={td} />
            </tr>
          </tbody>
        </table>
      </div>

      {sections.length > 0 && (
        <div data-lr-terms style={{ padding: '4px 12px 10px', fontSize: 9, lineHeight: 1.35 }}>
          <div style={{ textAlign: 'center', fontWeight: 700, color: INK, fontSize: 13, marginBottom: 2 }}>Terms and Conditions</div>
          {sections.map((s, i) => (
            <div key={i} style={{ marginTop: 3 }}>
              {s.heading && <div style={{ fontWeight: 700, color: INK }}>{s.heading}</div>}
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {s.points.map((p, j) => (
                  <li key={j}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Party({ title, party }: { title: string; party?: { name?: string; address?: string; gstin?: string; state?: string } | null }) {
  return (
    <div style={{ padding: '4px 10px' }}>
      <Line label={`${title} Name`} value={party?.name} strong />
      <Line label="Address" value={party?.address} />
      <Pair left={<Line label="GSTIN" value={party?.gstin} />} right={<Line label="State" value={partyState(party)} />} />
    </div>
  );
}

/** A label and its value on a ruled line — left to be written on when the value is not known. */
function Line({ label, value, strong, boxed, last }: { label: string; value?: React.ReactNode; strong?: boolean; boxed?: boolean; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'baseline',
        padding: boxed ? '4px 6px' : '5px 0 2px',
        borderBottom: boxed ? (last ? 0 : `1px solid ${INK}`) : undefined,
        fontSize: 12,
      }}
    >
      <span style={{ color: INK, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}:</span>
      <span style={{ flex: 1, borderBottom: boxed ? 0 : '1px solid #555', minHeight: 15, fontWeight: strong ? 600 : 400 }}>{value ?? ''}</span>
    </div>
  );
}

function Pair({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 18 }}>
      {left}
      {right}
    </div>
  );
}

/** "Closed / Open" as printed — the one that applies picked out, the other struck through once one is known. */
function Choice({ options, chosen }: { options: [string, string][]; chosen?: string | null }) {
  return (
    <span>
      {options.map(([code, text], i) => (
        <span key={code}>
          {i > 0 && ' / '}
          <span
            style={
              !chosen ? undefined : chosen === code ? { color: '#000', textDecoration: 'underline' } : { textDecoration: 'line-through', opacity: 0.55 }
            }
          >
            {text}
          </span>
        </span>
      ))}
    </span>
  );
}

const sheet: React.CSSProperties = { maxWidth: 780, margin: '0 auto 22px', border: `1.5px solid ${INK}`, borderRadius: 4 };
const th: React.CSSProperties = { border: `1px solid ${INK}`, padding: '4px 6px', fontSize: 11, color: INK, fontWeight: 600, textAlign: 'center' };
const td: React.CSSProperties = { border: `1px solid ${INK}`, padding: '4px 6px', fontSize: 11.5 };
