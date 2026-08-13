'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { getConfig } from '@/app/admin/apis';
import { Config } from '@/app/admin/types';
import { getTrip } from '@/app/trips/apis';
import { TripDetail } from '@/app/trips/types';
import { Barcode } from '@/components/barcode';
import { fmtDate, inr } from '@/lib/format';
import { ErrorState, Loading } from '@/lib/ui';

/**
 * Printed lorry receipt — `/print/lr/[tripId]` (part 05 §5.1, FSD B6).
 *
 * A4 letterhead carrying the company GSTIN, PAN and CIN from the control
 * panel, consignor and consignee blocks, the goods table, vehicle and driver,
 * the six charge heads, terms, a Code 39 barcode of the LR number and three
 * signature blocks. The printed copy is the primary form.
 */
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

  const lr = trip.lr;
  const heads = lr?.chargeHeads;
  const total = heads
    ? heads.freightPaise + heads.loadingPaise + heads.unloadingPaise + heads.detentionPaise + heads.otherPaise - heads.discountPaise
    : 0;

  return (
    <div style={{ background: '#fff', color: '#000', padding: 20, fontFamily: 'var(--font-body)' }}>
      <div className="no-print" style={{ marginBottom: 14, display: 'flex', gap: 8 }}>
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
        <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
          A4 · the printed copy is the primary form
        </span>
      </div>

      <div className="sheet" style={{ maxWidth: 780, margin: '0 auto', border: '1px solid #000', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderBottom: '2px solid #000', paddingBottom: 10 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22 }}>{config.company.name}</div>
            <div style={{ fontSize: 11 }}>{config.company.address}</div>
            <div style={{ fontSize: 11 }}>
              GSTIN {config.company.gstin} · PAN {config.company.pan} · CIN {config.company.cin}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase' }}>Lorry receipt</div>
            <div className="mono" style={{ fontSize: 18 }}>
              {lr?.code ?? 'DRAFT'}
            </div>
            <div style={{ fontSize: 11 }}>Date {fmtDate(lr?.lrDate)}</div>
            <div style={{ marginTop: 6 }}>{lr?.code && <Barcode value={lr.code} height={34} />}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderBottom: '1px solid #000' }}>
          <Block title="Consignor">
            <div>{lr?.consignor.name}</div>
            <div style={{ fontSize: 11 }}>{lr?.consignor.address}</div>
            <div style={{ fontSize: 11 }}>GSTIN {lr?.consignor.gstin}</div>
          </Block>
          <Block title="Consignee" border>
            <div>{lr?.consignee.name}</div>
            <div style={{ fontSize: 11 }}>{lr?.consignee.address}</div>
            <div style={{ fontSize: 11 }}>GSTIN {lr?.consignee.gstin}</div>
          </Block>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Description of goods', 'Packages', 'Weight (MT)', 'Invoice no', 'Invoice value', 'E-way bill'].map((h) => (
                <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #000', padding: '6px 4px', fontSize: 10 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>{lr?.goods.description}</td>
              <td style={cell}>{lr?.goods.packages}</td>
              <td style={cell}>{lr?.goods.weightTn}</td>
              <td style={cell}>{lr?.invoice.number}</td>
              <td style={cell}>{inr(lr?.invoice.valuePaise ?? 0)}</td>
              <td style={cell}>{lr?.eway.number || '—'}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid #000' }}>
          <Block title="Vehicle and driver">
            <div style={{ fontSize: 11 }}>
              {trip.vehicleNo} · {trip.vehicleType}
            </div>
            <div style={{ fontSize: 11 }}>
              {trip.driverName} · {trip.driverLicence}
            </div>
            <div style={{ fontSize: 11 }}>
              Transit {trip.transitDaysRequired} days · Trip {trip.code}
            </div>
            {lr?.remarks && <div style={{ fontSize: 11 }}>Remarks: {lr.remarks}</div>}
          </Block>
          <Block title="Charges" border>
            {heads && (
              <table style={{ width: '100%', fontSize: 11 }}>
                <tbody>
                  <ChargeRow label="Freight" value={heads.freightPaise} />
                  <ChargeRow label="Loading" value={heads.loadingPaise} />
                  <ChargeRow label="Unloading" value={heads.unloadingPaise} />
                  <ChargeRow label="Detention" value={heads.detentionPaise} />
                  <ChargeRow label="Other" value={heads.otherPaise} />
                  <ChargeRow label="Discount" value={-heads.discountPaise} />
                  <tr>
                    <td style={{ borderTop: '1px solid #000', fontWeight: 700 }}>Total</td>
                    <td style={{ borderTop: '1px solid #000', textAlign: 'right', fontWeight: 700 }}>{inr(total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </Block>
        </div>

        <div style={{ borderTop: '1px solid #000', padding: '8px 4px', fontSize: 9.5, lineHeight: 1.45 }}>
          <strong>Terms.</strong> Goods are carried at owner’s risk. The carrier is not responsible for leakage,
          breakage or loss arising from causes beyond its control. Delivery is against production of this receipt
          and proof of identity. Any claim must be lodged in writing within seven days of delivery. Subject to
          the jurisdiction of the courts at the booking branch.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, paddingTop: 34, borderTop: '1px solid #000' }}>
          {['Consignor', 'For the carrier', 'Consignee'].map((label) => (
            <div key={label} style={{ borderTop: '1px solid #000', paddingTop: 4, fontSize: 10, textAlign: 'center' }}>
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const cell: React.CSSProperties = { padding: '6px 4px', borderBottom: '1px solid #ccc', fontSize: 11 };

function Block({ title, children, border }: { title: string; children: React.ReactNode; border?: boolean }) {
  return (
    <div style={{ padding: '8px 10px', borderLeft: border ? '1px solid #000' : undefined }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>{title}</div>
      {children}
    </div>
  );
}

function ChargeRow({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <td>{label}</td>
      <td style={{ textAlign: 'right' }} className="mono">
        {inr(value)}
      </td>
    </tr>
  );
}
