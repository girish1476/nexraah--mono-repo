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
import { inr, dateTime } from '@/lib/format';
import { TRIP_TONE } from '@/lib/status';
import { getTrip } from '../apis';
import { CLOCK_RULE, CLOCK_STOPS_AT, podClock } from '../pod-clock';
import { POD_STATUS_LABEL, TRIP_STATUS_LABEL, Trip, TripStatus } from '../types';

/**
 * What each trip status means for the money, in the driver's words. The label
 * alone ("Placed", "Closed") tells a phone user nothing they can act on.
 * Redaction (BR-55): sentences about this transporter's own trip only.
 */
const TRIP_REASON: Record<TripStatus, string> = {
  PLACED: 'Your truck is booked for this load. Nothing has moved yet.',
  REPORTED: 'Your truck has reached the loading point and is waiting its turn.',
  LOADED: 'Goods are on board and your lorry receipt has been issued.',
  IN_TRANSIT: 'The truck is on the road. The balance falls due after it unloads.',
  DELIVERED: 'The goods have been handed over. Your 20 days to send the paper copy start now.',
  CLOSED: 'This trip is finished and nothing further will change on it.',
};

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
      <AppHeader />
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
      <AppHeader />
      <ScreenHeader
        title={trip.id}
        sub={`${trip.originCity} → ${trip.destinationCity}${
          trip.distanceKm === null ? '' : ` · ${trip.distanceKm.toLocaleString('en-IN')} km`
        }`}
        what="One trip, and all its money in one place: what has already been paid to you, what is still to come, and the exact thing holding the rest up."
        back="Trips"
        right={
          <Pill tone={TRIP_TONE[trip.status]} reason={TRIP_REASON[trip.status]}>
            {TRIP_STATUS_LABEL[trip.status]}
          </Pill>
        }
      />

      {/* Advance — held, with every reason named. */}
      {trip.advanceBlockers.length > 0 ? (
        <Callout tone="red" title={`${inr(trip.advancePaise)} advance held`}>
          {trip.advanceBlockers.length} document
          {trip.advanceBlockers.length === 1 ? '' : 's'} gate the advance — meaning this money
          stays with us until each one is on file. Every item below is yours to fix, and the
          advance is released once they are all in.
          <ul style={{ marginTop: 10, paddingLeft: 18 }}>
            {trip.advanceBlockers.map((b) => (
              <li key={b.what} style={{ marginBottom: 8, fontSize: 15 }}>
                {b.what}
                <span className="muted" style={{ display: 'block' }}>
                  {b.why}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/profile" className="tap" style={{ fontSize: 15, fontWeight: 700 }}>
            Upload them in Profile →
          </Link>
        </Callout>
      ) : trip.advanceReleasedAt ? (
        <Callout tone="mint" title={`${inr(trip.advancePaise)} advance released`}>
          This part is already paid to you. Nothing to do here.
          <p style={{ marginTop: 6 }}>
            Sent {dateTime(trip.advanceReleasedAt)}
            {trip.advanceUtr ? ` · UTR ${trip.advanceUtr}` : ''}
          </p>
          {trip.advanceUtr && (
            <p className="muted" style={{ marginTop: 4 }}>
              UTR is the bank&rsquo;s reference for that transfer. Give it to your bank if you need
              to trace the money.
            </p>
          )}
        </Callout>
      ) : (
        /*
         * Neither blocked nor confirmed paid — and we must not guess.
         *
         * `advanceBlockers` is always `[]` and `advanceReleasedAt` always null
         * on this surface: both `trip_documents` and `payments` are revoked
         * from the transporter database pool, so this app genuinely cannot see
         * whether the advance has been released (`portal-trips.service.ts`).
         *
         * An empty blocker list used to fall through to "already paid to you",
         * which told every transporter on every trip that they had been paid
         * whether or not they had. Saying less is the only honest option here.
         */
        <Callout tone="grey" title={`${inr(trip.advancePaise)} advance on this trip`}>
          That is the advance agreed for this load — {trip.advancePct}% of your rate. Whether it has
          been sent yet is not shown here.
          <p className="muted" style={{ marginTop: 6 }}>
            Your own bank record is the reliable answer. If it has not arrived, call your Nexraah
            branch contact — they can see the exact reason and clear it.
          </p>
        </Callout>
      )}

      {/* POD clock — the risk this design puts on the transporter, stated. */}
      {clock && (
        <Callout tone={clock.tone} title={clock.headline}>
          Delivered {trip.deliveredAt ? dateTime(trip.deliveredAt) : '—'}. {CLOCK_RULE}
          <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
            <li style={{ marginBottom: 4 }}>
              <strong>Day 1 to day 20:</strong> nothing comes off. Your full{' '}
              {inr(trip.balancePaise)} balance is safe.
            </li>
            <li style={{ marginBottom: 4 }}>
              <strong>Day 21 onwards:</strong> {inr(trip.podPenaltyPerDayPaise)} comes off your
              balance every single day.
            </li>
            <li>
              <strong>After day 40:</strong> the whole balance is gone. You are paid nothing for
              this trip.
            </li>
          </ul>
          <p
            style={{
              marginTop: 10,
              fontWeight: 700,
              color: 'var(--red)',
              lineHeight: 1.45,
            }}
          >
            Sending photos here does not stop the days counting. {CLOCK_STOPS_AT} Courier the
            signed paper today.
          </p>
          {!clock.forfeited && (
            <Link
              href={`/trips/${trip.id}/pod`}
              className="tap"
              style={{ fontWeight: 700, marginTop: 6 }}
            >
              {trip.podStatus === 'PENDING' ? 'Attach the POD →' : 'Re-attach the POD →'}
            </Link>
          )}
        </Callout>
      )}

      <Facts
        rows={[
          ['Trip status', TRIP_STATUS_LABEL[trip.status]],
          ['Delivery paper', POD_STATUS_LABEL[trip.podStatus]],
          ['Vehicle', trip.vehicleRegistrationNo],
          [
            'Driver',
            trip.driverName || trip.driverPhone
              ? `${trip.driverName ?? 'Not recorded yet'} · ${trip.driverPhone ?? 'Not recorded yet'}`
              : 'Not recorded yet',
          ],
          ['Freight agreed', inr(trip.freightPaise)],
          [`Advance ${trip.advancePct}%`, inr(trip.advancePaise)],
          ['Balance after advance', inr(trip.balancePaise)],
        ]}
      />

      {/* Balance and deductions, itemised. */}
      <div className="card">
        <p className="card-title" style={{ marginBottom: 4 }}>
          What you will be paid
        </p>
        <p className="muted" style={{ marginBottom: 8 }}>
          The full trip amount, then everything that comes off it. The last line is what actually
          reaches your account.
        </p>
        {[
          [
            'Billable freight',
            'The whole trip amount, before anything comes off',
            inr(trip.freightPaise),
            'var(--color-text)',
          ],
          [
            'Less advance paid',
            trip.advanceUtr
              ? `Already in your account · UTR ${trip.advanceUtr}`
              : 'Not released yet — counted here all the same, so the figure below is what is left',
            '−' + inr(trip.advancePaise),
            'var(--color-text)',
          ],
          [
            'Less late-paper deduction',
            trip.penaltyPaise
              ? `${(trip.podDaysElapsed ?? 0) - 20} days beyond 20 · ${inr(trip.podPenaltyPerDayPaise)}/day off your balance`
              : 'None so far — nothing has come off your balance',
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
        <p className="muted" style={{ marginTop: 6 }}>
          Paid after your delivery paper is approved and your bill is submitted.
        </p>
      </div>

      {/* Milestones */}
      <div className="card">
        <p className="card-title" style={{ marginBottom: 2 }}>
          Where this trip has reached
        </p>
        <p className="muted" style={{ marginBottom: 8 }}>
          Filled dots have happened. Empty dots are still to come.
        </p>
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
            <span className="muted" style={{ display: 'block', marginTop: 2 }}>
              The transport document for this load — keep a copy in the cab
            </span>
          </Link>
        )}
        {trip.podStatus === 'APPROVED' && (
          <Link href={`/trips/${trip.id}/bill`} className="card" style={{ marginBottom: 0 }}>
            Raise your bill
            <span className="muted" style={{ display: 'block', marginTop: 2 }}>
              Send us your bill for the {inr(trip.netPayablePaise)} balance
            </span>
          </Link>
        )}
      </div>

      <TabBar />
    </main>
  );
}
