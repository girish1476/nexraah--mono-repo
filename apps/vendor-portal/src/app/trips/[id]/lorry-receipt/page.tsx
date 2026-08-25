'use client';

import { useEffect, useState } from 'react';
import { Callout, ErrorNote, Facts, Loading, Pill, ScreenHeader, TabBar } from '@/components/shell';
import { code39 } from '@/lib/code39';
import { inr, dateTime } from '@/lib/format';
import { getLorryReceipt } from '../../apis';
import { CLOCK_RULE, CLOCK_STOPS_AT } from '../../pod-clock';
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
      () => setShared('Link copied — paste it into WhatsApp or a message'),
      () => setShared('Could not copy the link. Use Download PDF and send the file instead.'),
    );
  };

  return (
    <main className="screen">
      <ScreenHeader
        title="Lorry receipt"
        what="The transport document for this load. Print it and keep it in the cab — checkposts and the receiving party both ask for it, and it is the paper the receiver signs at delivery."
        back={params.id}
      />

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
          <Pill
            tone="mint"
            reason="This receipt is issued and is yours to carry. Nothing is pending on it."
          >
            Released to you
          </Pill>
        </div>
      </div>

      <Facts
        rows={[
          ['Route', `${lr.originCity} → ${lr.destinationCity}`],
          ['Goods', lr.goods],
          ['Weight loaded', `${lr.weightKg / 1000} MT`],
          ['Truck type', lr.truckType],
          ['Vehicle', lr.vehicleRegistrationNo],
          ['Driver', `${lr.driverName} · ${lr.driverLicenceNo}`],
          ['Days allowed for the trip', String(lr.transitDays)],
          ['E-way bill', lr.ewayBillNo],
          ['E-way bill valid until', dateTime(lr.ewayValidUpto)],
        ]}
      />

      <div className="card">
        <p className="card-title" style={{ marginBottom: 2 }}>
          Your freight on this load
        </p>
        <p className="muted" style={{ marginBottom: 8 }}>
          What you were awarded, what has already been paid, and what is still to come.
        </p>
        {[
          ['Agreed freight', inr(lr.freightPaise)],
          ['Advance paid to you', '−' + inr(lr.advancePaise)],
          ['Balance, paid on proof of delivery', inr(lr.balancePaise)],
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

      {/* The clock, said once here too: this is the paper it is about (`BR-12`). */}
      <Callout tone="flag" title="This paper is what gets your balance paid">
        <p>
          At delivery the receiver signs this receipt. Get that signed paper to our branch within
          20 days. {CLOCK_RULE}
        </p>
        <p style={{ marginTop: 8, fontWeight: 700 }}>
          {CLOCK_STOPS_AT} Photographing it in the app starts the check, but only the paper landing
          at the branch stops the days counting.
        </p>
      </Callout>

      <p className="muted" style={{ marginBottom: 12 }}>
        Carry a printed copy. The barcode is scanned at checkposts and by the receiving party, and
        without it the truck can be held up on the road.
      </p>

      <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
        <a
          href={lr.pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="tap"
          style={{
            justifyContent: 'center',
            textAlign: 'center',
            borderRadius: 10,
            padding: '14px 12px',
            fontWeight: 600,
            background: 'var(--color-accent)',
            color: '#fff',
            textDecoration: 'none',
          }}
        >
          Download PDF to print
        </a>
        <button
          onClick={share}
          className="tap"
          style={{
            justifyContent: 'center',
            borderRadius: 10,
            padding: '12px',
            fontWeight: 600,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-divider)',
          }}
        >
          Send to the driver
        </button>
        {shared && <p className="muted">{shared}</p>}
      </div>

      <TabBar />
    </main>
  );
}
