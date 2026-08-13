'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Callout, ErrorNote, Facts, Loading, Pill, ScreenHeader, TabBar } from '@/components/shell';
import { inr, dateTime } from '@/lib/format';
import { TRIP_TONE } from '@/lib/status';
import { getTrip } from '../apis';
import { CLOCK_RULE, CLOCK_STOPS_AT, podClock } from '../pod-clock';
import { POD_STATUS_LABEL, TRIP_STATUS_LABEL, Trip } from '../types';

export default function TripPage({ params }: { params: { id: string } }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTrip(params.id)
      .then(setTrip)
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (!trip) {
    return (
      <main className="screen">
        <ScreenHeader title={params.id} back="Trips" />
        {error ? <ErrorNote message={error} /> : <Loading />}
        <TabBar />
      </main>
    );
  }

  const clock =
    trip.deliveredAt && trip.podDaysElapsed !== null && trip.podStatus !== 'APPROVED'
      ? podClock(trip.podDaysElapsed, trip.podPenaltyPerDayPaise)
      : null;

  return (
    <main className="screen">
      <ScreenHeader
        title={trip.id}
        sub={`${trip.originCity} → ${trip.destinationCity} · ${trip.distanceKm.toLocaleString('en-IN')} km`}
        back="Trips"
        right={<Pill tone={TRIP_TONE[trip.status]}>{TRIP_STATUS_LABEL[trip.status]}</Pill>}
      />

      {/* Advance — held, with every reason named. */}
      {trip.advanceBlockers.length > 0 ? (
        <Callout tone="red" title={`${inr(trip.advancePaise)} advance held`}>
          {trip.advanceBlockers.length} document
          {trip.advanceBlockers.length === 1 ? '' : 's'} gate the advance. Each one is yours to
          clear.
          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            {trip.advanceBlockers.map((b) => (
              <li key={b.what} style={{ marginBottom: 6, fontSize: 14 }}>
                {b.what}
                <span className="muted" style={{ display: 'block' }}>
                  {b.why}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/profile" style={{ fontSize: 13 }}>
            Upload them in Profile →
          </Link>
        </Callout>
      ) : (
        <Callout tone="mint" title={`${inr(trip.advancePaise)} advance released`}>
          {trip.advanceReleasedAt
            ? `${dateTime(trip.advanceReleasedAt)}${trip.advanceUtr ? ` · UTR ${trip.advanceUtr}` : ''}`
            : null}
        </Callout>
      )}

      {/* POD clock — the risk this design puts on the transporter, stated. */}
      {clock && (
        <Callout tone={clock.tone} title={clock.headline}>
          Delivered {trip.deliveredAt ? dateTime(trip.deliveredAt) : '—'}. {CLOCK_RULE}
          <p style={{ marginTop: 6, fontWeight: 500 }}>{CLOCK_STOPS_AT}</p>
          {!clock.forfeited && (
            <Link href={`/trips/${trip.id}/pod`}>
              {trip.podStatus === 'PENDING' ? 'Attach the POD →' : 'Re-attach the POD →'}
            </Link>
          )}
        </Callout>
      )}

      <Facts
        rows={[
          ['Status', TRIP_STATUS_LABEL[trip.status]],
          ['Proof of delivery', POD_STATUS_LABEL[trip.podStatus]],
          ['Vehicle', trip.vehicleRegistrationNo],
          ['Driver', `${trip.driverName} · ${trip.driverPhone}`],
          ['Freight', inr(trip.freightPaise)],
          [`Advance ${trip.advancePct}%`, inr(trip.advancePaise)],
          ['Balance', inr(trip.balancePaise)],
        ]}
      />

      {/* Balance and deductions, itemised. */}
      <div className="card">
        <p className="card-title" style={{ marginBottom: 8 }}>
          What you will be paid
        </p>
        {[
          ['Billable freight', 'As awarded', inr(trip.freightPaise), 'var(--color-text)'],
          [
            'Less advance paid',
            trip.advanceUtr ? `UTR ${trip.advanceUtr}` : 'Not released yet',
            '−' + inr(trip.advancePaise),
            'var(--color-text)',
          ],
          [
            'Less POD penalty',
            trip.penaltyPaise
              ? `${(trip.podDaysElapsed ?? 0) - 20} days beyond 20 · ${inr(trip.podPenaltyPerDayPaise)}/day`
              : 'None so far',
            '−' + inr(trip.penaltyPaise),
            trip.penaltyPaise ? 'var(--red)' : 'var(--color-text)',
          ],
        ].map(([label, note, value, ink]) => (
          <div
            key={label}
            className="row-between"
            style={{ padding: '8px 0', borderTop: '1px solid var(--color-divider)' }}
          >
            <span>
              {label}
              <span className="muted" style={{ display: 'block' }}>
                {note}
              </span>
            </span>
            <span style={{ color: ink, fontWeight: 500 }}>{value}</span>
          </div>
        ))}
        <div
          className="row-between"
          style={{ paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}
        >
          <strong>Net payable</strong>
          <strong>{inr(trip.netPayablePaise)}</strong>
        </div>
      </div>

      {/* Milestones */}
      <div className="card">
        {trip.milestones.map((m) => (
          <div key={m.key} style={{ display: 'flex', gap: 10, padding: '7px 0' }}>
            <span
              style={{
                width: 10,
                height: 10,
                marginTop: 6,
                borderRadius: 999,
                flexShrink: 0,
                border: `2px solid ${m.done ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'}`,
                background: m.done ? 'var(--color-accent-700)' : 'transparent',
              }}
            />
            <span style={{ opacity: m.done ? 1 : 0.55 }}>
              {m.label}
              <span className="muted" style={{ display: 'block' }}>
                {m.at ? dateTime(m.at) : 'awaited'}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
        {trip.lrNo && (
          <Link href={`/trips/${trip.id}/lorry-receipt`} className="card" style={{ marginBottom: 0 }}>
            Lorry receipt {trip.lrNo}
          </Link>
        )}
        {trip.podStatus === 'APPROVED' && (
          <Link href={`/trips/${trip.id}/bill`} className="card" style={{ marginBottom: 0 }}>
            Raise your bill
          </Link>
        )}
      </div>

      <TabBar />
    </main>
  );
}
