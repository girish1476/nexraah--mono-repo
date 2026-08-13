'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AccountLink, ErrorNote, Loading, Pill, ScreenHeader, TabBar } from '@/components/shell';
import { inr, dateTime } from '@/lib/format';
import { POD_TONE, TRIP_TONE } from '@/lib/status';
import { getTrips } from './apis';
import { POD_STATUS_LABEL, TRIP_STATUS_LABEL, Trip } from './types';

/** Every action always renders; a disabled one states what would unblock it (part 05 §1). */
function actions(t: Trip) {
  return [
    {
      label: 'Lorry receipt',
      href: `/trips/${t.id}/lorry-receipt`,
      enabled: !!t.lrNo,
      blocked: 'LR not issued yet',
    },
    {
      label: 'Proof of delivery',
      href: `/trips/${t.id}/pod`,
      enabled: t.status === 'DELIVERED' || t.podStatus === 'REJECTED',
      blocked: 'Trip not delivered yet',
    },
    {
      label: 'Raise your bill',
      href: `/trips/${t.id}/bill`,
      enabled: t.podStatus === 'APPROVED',
      blocked: 'Proof of delivery not yet approved',
    },
  ];
}

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTrips()
      .then(setTrips)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="screen">
      <ScreenHeader
        title="Trips"
        sub="What you are carrying and what is owed on it"
        right={<AccountLink />}
      />

      {error && <ErrorNote message={error} />}
      {!trips && !error && <Loading />}
      {trips?.length === 0 && <p className="muted">No trips awarded yet.</p>}

      {trips?.map((t) => (
        <div key={t.id} className="card">
          <div className="row-between">
            <Link href={`/trips/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="card-title">
                {t.originCity} → {t.destinationCity}
              </span>
            </Link>
            <Pill tone={TRIP_TONE[t.status]}>{TRIP_STATUS_LABEL[t.status]}</Pill>
          </div>
          <p className="muted">
            {t.id}
            {t.lrNo ? ` · ${t.lrNo}` : ''} · {t.vehicleRegistrationNo}
          </p>

          {/* What is owed — the reason this screen gets opened. */}
          <p style={{ fontSize: 18, fontWeight: 600, marginTop: 10 }}>
            {inr(t.netPayablePaise)} due on POD
          </p>
          <p className="muted">
            {t.advanceReleasedAt
              ? `${inr(t.advancePaise)} advance paid ${dateTime(t.advanceReleasedAt)}${t.advanceUtr ? ` · UTR ${t.advanceUtr}` : ''}`
              : `${inr(t.advancePaise)} advance held — ${t.advanceBlockers.length} document${t.advanceBlockers.length === 1 ? '' : 's'} blocking`}
          </p>
          <p style={{ marginTop: 6 }}>
            <Pill tone={POD_TONE[t.podStatus]}>POD · {POD_STATUS_LABEL[t.podStatus]}</Pill>
          </p>

          <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            {actions(t).map((a) =>
              a.enabled ? (
                <Link
                  key={a.label}
                  href={a.href}
                  style={{
                    border: '1px solid var(--color-divider)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 14,
                    textDecoration: 'none',
                    color: 'var(--color-accent-700)',
                  }}
                >
                  {a.label}
                </Link>
              ) : (
                <div
                  key={a.label}
                  style={{
                    border: '1px dashed var(--color-divider)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 14,
                    color: 'var(--color-neutral-700)',
                  }}
                >
                  {a.label}
                  <span style={{ display: 'block', fontSize: 12 }}>✗ {a.blocked}</span>
                </div>
              ),
            )}
          </div>
        </div>
      ))}

      <TabBar />
    </main>
  );
}
