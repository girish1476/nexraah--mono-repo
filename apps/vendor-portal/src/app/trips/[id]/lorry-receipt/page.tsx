'use client';

import { useEffect, useState } from 'react';
import { ErrorNote, Facts, Loading, Pill, ScreenHeader, TabBar } from '@/components/shell';
import { code39 } from '@/lib/code39';
import { inr, dateTime } from '@/lib/format';
import { getLorryReceipt } from '../../apis';
import { LorryReceipt } from '../../types';

function Barcode({ value }: { value: string }) {
  const { bars, width } = code39(value);
  return (
    <svg
      viewBox={`0 0 ${width} 60`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 60, display: 'block' }}
      role="img"
      aria-label={`Barcode ${value}`}
    >
      <rect width={width} height={60} fill="#fff" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.width} height={60} fill="#000" />
      ))}
    </svg>
  );
}

export default function LorryReceiptPage({ params }: { params: { id: string } }) {
  const [lr, setLr] = useState<LorryReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<string | null>(null);

  useEffect(() => {
    getLorryReceipt(params.id)
      .then(setLr)
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (!lr) {
    return (
      <main className="screen">
        <ScreenHeader title="Lorry receipt" back={params.id} />
        {error ? <ErrorNote message={error} /> : <Loading />}
        <TabBar />
      </main>
    );
  }

  const share = () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      nav.share({ title: lr.lrNo, url: lr.pdfUrl }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(lr.pdfUrl).then(
      () => setShared('Link copied'),
      () => setShared('Could not copy the link'),
    );
  };

  return (
    <main className="screen">
      <ScreenHeader title="Lorry receipt" back={params.id} />

      <div className="card" style={{ textAlign: 'center' }}>
        <p
          style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 20,
            letterSpacing: 1,
          }}
        >
          {lr.lrNo}
        </p>
        <p className="muted" style={{ marginBottom: 12 }}>
          Issued {dateTime(lr.issuedAt)}
        </p>
        <Barcode value={lr.lrNo} />
        <div style={{ marginTop: 10 }}>
          <Pill tone="mint">Released to you</Pill>
        </div>
      </div>

      <Facts
        rows={[
          ['Lane', `${lr.originCity} → ${lr.destinationCity}`],
          ['Goods', lr.goods],
          ['Weight', `${lr.weightKg / 1000} MT`],
          ['Truck type', lr.truckType],
          ['Vehicle', lr.vehicleRegistrationNo],
          ['Driver', `${lr.driverName} · ${lr.driverLicenceNo}`],
          ['Transit days', String(lr.transitDays)],
          ['E-way bill', lr.ewayBillNo],
          ['E-way valid upto', dateTime(lr.ewayValidUpto)],
        ]}
      />

      <div className="card">
        <p className="card-title" style={{ marginBottom: 8 }}>
          Your freight
        </p>
        {[
          ['Agreed freight', inr(lr.freightPaise)],
          ['Advance paid', '−' + inr(lr.advancePaise)],
          ['Balance on POD', inr(lr.balancePaise)],
        ].map(([k, v], i) => (
          <div
            key={k}
            className="row-between"
            style={{ padding: '8px 0', borderTop: i ? '1px solid var(--color-divider)' : 'none' }}
          >
            <span className="muted">{k}</span>
            <span style={{ fontWeight: i === 2 ? 700 : 500 }}>{v}</span>
          </div>
        ))}
      </div>

      <p className="muted" style={{ marginBottom: 12 }}>
        Carry a printed copy. The barcode is scanned at checkposts and at the consignee.
      </p>

      <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        <a
          href={lr.pdfUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'block',
            textAlign: 'center',
            borderRadius: 10,
            padding: '14px 12px',
            fontWeight: 600,
            background: 'var(--color-accent)',
            color: '#fff',
            textDecoration: 'none',
          }}
        >
          Download PDF
        </a>
        <button
          onClick={share}
          style={{
            borderRadius: 10,
            padding: '12px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-divider)',
          }}
        >
          Share
        </button>
        {shared && <p className="muted">{shared}</p>}
      </div>

      <TabBar />
    </main>
  );
}
