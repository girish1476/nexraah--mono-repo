'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AppHeader,
  Callout,
  ErrorNote,
  Facts,
  Loading,
  Pill,
  ScreenHeader,
  TabBar,
} from '@/components/shell';
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
      <AppHeader />
        <ScreenHeader title="Lorry receipt" back={params.id} />
        {error ? <ErrorNote message={error} /> : <Loading />}
        <TabBar />
      </main>
    );
  }

  const share = () => {
    // Also `lr.pdfUrl` until now, which meant this shared the literal string
    // '#' — a share sheet offering nothing, or a clipboard containing one
    // character. The printable copy is a real, openable address.
    const url = `${window.location.origin}/print/lr/${params.id}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      nav.share({ title: lr.lrNo, url }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(url).then(
      () => setShared('Link copied — paste it into WhatsApp or a message'),
      () => setShared('Could not copy the link. Open the printable copy and share it from there.'),
    );
  };

  return (
    <main className="screen">
      <AppHeader />
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
          ['Weight loaded', lr.weightKg === null ? 'Not recorded' : `${lr.weightKg / 1000} MT`],
          ['Truck type', lr.truckType ?? 'Not recorded'],
          ['Vehicle', lr.vehicleRegistrationNo],
          ['Driver', `${lr.driverName ?? 'Not recorded'} · ${lr.driverLicenceNo ?? 'Not recorded'}`],
          [
            'Days allowed for the trip',
            lr.transitDays === null ? 'Not recorded' : String(lr.transitDays),
          ],
          ['E-way bill', lr.ewayBillNo ?? 'Not recorded'],
          ['E-way bill valid until', lr.ewayValidUpto ? dateTime(lr.ewayValidUpto) : 'Not recorded'],
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
        {/*
          * Was `href={lr.pdfUrl} target="_blank"`, which could not work:
          * `pdfUrl` is '#' in the fixture and null from the real API, so this
          * opened a blank tab instead of downloading anything. It now opens
          * the printable copy, where the browser's own dialog offers "Save as
          * PDF". Deliberately same-tab — the vendor app runs this inside an
          * Android WebView, which drops `target="_blank"` on the floor.
          */}
        <Link
          href={`/print/lr/${params.id}`}
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
          Open the printable copy
        </Link>
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
