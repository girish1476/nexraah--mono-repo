'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AccountLink,
  EmptyState,
  ErrorNote,
  Loading,
  Pill,
  ScreenHeader,
  TabBar,
} from '@/components/shell';
import { inr, dateTime } from '@/lib/format';
import { POD_TONE, TRIP_TONE } from '@/lib/status';
import { getTrips } from './apis';
import { podClock } from './pod-clock';
import { POD_STATUS_LABEL, PodStatus, TRIP_STATUS_LABEL, Trip } from './types';

/**
 * Why the POD status is what it is, in the driver's words. Every line either
 * says the money is safe or names the one thing that would make it safe —
 * a bare "Not attached" is the middle of the "so much confusing" complaint.
 *
 * `BR-49`/`D-35` is the point most of these carry: attaching is not receiving.
 * Redaction (BR-55): these are sentences about the transporter's own paperwork.
 */
const POD_REASON: Record<PodStatus, string> = {
  PENDING:
    'We have not received your delivery paper yet. Sending the signed original is what stops money coming off.',
  ATTACHED:
    'Your photos reached us. Money still comes off each day until the branch holds the paper original in hand.',
  RECEIVED: 'The branch has your paper copy. Nothing more comes off from here.',
  VERIFIED: 'Your paper copy has been checked and is correct. Approval is the last step.',
  APPROVED: 'Cleared. You can raise your bill for the balance now.',
  REJECTED:
    'The paper copy was not accepted, so this trip counts as still unpaid — money keeps coming off each day until a good copy reaches the branch.',
};

/** Every action always renders; a disabled one states what would unblock it (part 05 §1). */
function actions(t: Trip) {
  return [
    {
      label: 'Lorry receipt',
      href: `/trips/${t.id}/lorry-receipt`,
      enabled: !!t.lrNo,
      blocked: 'LR not issued yet — it appears once the truck is loaded at the plant',
    },
    {
      label: 'Proof of delivery',
      href: `/trips/${t.id}/pod`,
      enabled: t.status === 'DELIVERED' || t.podStatus === 'REJECTED',
      blocked: 'Trip not delivered yet — this opens the day the truck unloads',
    },
    {
      label: 'Raise your bill',
      href: `/trips/${t.id}/bill`,
      enabled: t.podStatus === 'APPROVED',
      blocked: 'Proof of delivery not yet approved — billing opens the day it is',
    },
  ];
}

/**
 * The clock only means something while the branch is still waiting for paper —
 * once it is in hand (received / verified / approved) nothing more comes off,
 * so showing a countdown there would only frighten. `BR-12`/`BR-24`/`BR-25`.
 */
const CLOCK_RUNNING: PodStatus[] = ['PENDING', 'ATTACHED', 'REJECTED'];

function clockLine(t: Trip) {
  if (t.podDaysElapsed === null || !CLOCK_RUNNING.includes(t.podStatus)) return null;
  const c = podClock(t.podDaysElapsed, t.podPenaltyPerDayPaise);
  return (
    <p
      style={{
        marginTop: 8,
        fontSize: 15,
        lineHeight: 1.45,
        fontWeight: 600,
        color: `var(--${c.tone})`,
      }}
    >
      {c.headline}
      <span style={{ display: 'block', fontWeight: 500, color: 'var(--color-neutral-700)' }}>
        {c.forfeited
          ? 'More than 40 days have passed since delivery, so no balance is payable on this trip.'
          : '20 days from delivery, then ₹100 off every day, and nothing at all after 40 days. Only the paper copy reaching our branch stops it — photos do not.'}
      </span>
    </p>
  );
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
        sub="Every load you are carrying or have carried"
        what="Each trip below shows the money still to reach you and the one thing holding it up. Money is paid in two parts: an advance, then the balance once your signed delivery paper reaches our branch."
        right={<AccountLink />}
      />

      {error && <ErrorNote message={error} />}
      {!trips && !error && <Loading />}
      {trips?.length === 0 && (
        <EmptyState
          title="No trips yet"
          what="A trip appears here the moment a load is awarded to you. It will show the freight agreed, the advance, and the balance still to come."
          next="Quote on an open load first. Win it, and the trip lands on this screen on its own."
          action={
            <Link href="/loads" className="tap" style={{ fontWeight: 700 }}>
              See loads open to you →
            </Link>
          }
        />
      )}

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

          {/* What is owed — the reason this screen gets opened. Stays the first
              and largest thing in the card; the line under it says when it lands. */}
          <p style={{ fontSize: 18, fontWeight: 600, marginTop: 10 }}>
            {inr(t.netPayablePaise)} due on POD (proof of delivery)
          </p>
          <p className="muted">
            This is what still has to reach you, after the advance below. It is paid once your
            signed delivery paper reaches our branch.
          </p>

          <p className="muted" style={{ marginTop: 8 }}>
            {t.advanceReleasedAt
              ? `${inr(t.advancePaise)} advance paid ${dateTime(t.advanceReleasedAt)}${t.advanceUtr ? ` · UTR ${t.advanceUtr}` : ''}`
              : `${inr(t.advancePaise)} advance held — ${t.advanceBlockers.length} document${t.advanceBlockers.length === 1 ? '' : 's'} blocking`}
          </p>
          {!t.advanceReleasedAt && (
            <p className="muted">
              Add the missing vehicle papers and the advance is released to your account.
            </p>
          )}

          {/* The penalty clock, wherever a trip is delivered and the paper copy
              has not landed yet. BR-12/BR-24/BR-25, said in money and days. */}
          {clockLine(t)}

          <p style={{ marginTop: 10 }}>
            <Pill tone={POD_TONE[t.podStatus]} reason={POD_REASON[t.podStatus]}>
              POD · {POD_STATUS_LABEL[t.podStatus]}
            </Pill>
          </p>

          <div style={{ display: 'grid', gap: 6, marginTop: 14 }}>
            {actions(t).map((a) =>
              a.enabled ? (
                <Link
                  key={a.label}
                  href={a.href}
                  className="tap"
                  style={{
                    border: '1px solid var(--color-divider)',
                    borderRadius: 10,
                    padding: '11px 12px',
                    fontSize: 15,
                    fontWeight: 600,
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
                    padding: '11px 12px',
                    fontSize: 15,
                    color: 'var(--color-neutral-700)',
                  }}
                >
                  {a.label}
                  <span style={{ display: 'block', fontSize: 13, lineHeight: 1.4, marginTop: 2 }}>
                    ✗ {a.blocked}
                  </span>
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
