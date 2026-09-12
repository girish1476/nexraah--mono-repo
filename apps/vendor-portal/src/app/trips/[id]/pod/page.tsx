'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ActionBar,
  AppHeader,
  Callout,
  EmptyState,
  ErrorNote,
  Loading,
  ScreenHeader,
  TabBar,
} from '@/components/shell';
import { inr, dateTime } from '@/lib/format';
import { newIdempotencyKey } from '@/apis';
import { attachPod, getTrip } from '../../apis';
import { CLOCK_RULE, CLOCK_STOPS_AT, podClock } from '../../pod-clock';
import { Trip } from '../../types';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Four steps, each said as what happens rather than who owns it — and step 2
 * carries the fact that costs transporters money when they miss it (`BR-49`,
 * `D-35`): receipt of the paper, not the upload, is what stops the count.
 */
const CHAIN: [string, string][] = [
  ['You attach photos here', 'Takes a minute. Does not stop the days counting.'],
  [
    'The branch receives your paper copy',
    'This is the step that stops the days counting. Courier it today.',
  ],
  ['The branch checks it against the load', 'They match your paper against the trip.'],
  ['Approved', 'Your balance is cleared for billing.'],
];

const today = () => new Date().toISOString().slice(0, 10);

export default function PodPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [docket, setDocket] = useState('');
  const [sentOn, setSentOn] = useState(today());
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  // Minted once per mount and reused across a retry of the same submission —
  // a network drop and a re-tap of the button must not read as two attaches.
  const [idempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    getTrip(params.id)
      .then(setTrip)
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (!trip) {
    return (
      <main className="screen">
      <AppHeader />
        <ScreenHeader title="Proof of delivery" back={params.id} />
        {error ? <ErrorNote message={error} /> : <Loading />}
        <TabBar />
      </main>
    );
  }

  /**
   * The count starts at delivery, so a trip that has not been delivered has no
   * clock — the same guard the trip detail screen applies. Defaulting a null
   * `podDaysElapsed` to 0 used to render "20 days left in the window" on a
   * truck that had not moved yet, which tells a transporter their money is on
   * a countdown that has not begun.
   */
  const clock =
    trip.deliveredAt && trip.podDaysElapsed !== null
      ? podClock(trip.podDaysElapsed, trip.podPenaltyPerDayPaise)
      : null;
  const chainDone =
    trip.podStatus === 'APPROVED' ? 4 : trip.podStatus === 'VERIFIED' ? 3 : trip.podStatus === 'RECEIVED' ? 2 : trip.podStatus === 'ATTACHED' ? 1 : 0;

  const oversize = files.find((f) => f.size > MAX_BYTES);
  const valid =
    files.length > 0 && !oversize && docket.trim() !== '' && sentOn !== '' && sentOn <= today();

  const submit = () => {
    if (!valid) return;
    setSending(true);
    attachPod(trip.id, { files, courierDocketNo: docket.trim(), sentOn, note: note.trim() }, idempotencyKey)
      .then(() => router.push(`/trips/${trip.id}`))
      .catch((e) => {
        setError(e.message);
        setSending(false);
      });
  };

  return (
    <main className="screen">
      <AppHeader />
      <ScreenHeader
        title="Proof of delivery"
        sub={`${trip.id} · ${trip.originCity} → ${trip.destinationCity}`}
        what="This is where you send us the signed delivery paper for this trip. It is what releases your balance — and every day it is late takes money off that balance."
        back={trip.id}
      />

      {error && <ErrorNote message={error} />}

      {/* The clock, first on the screen: it is the money. */}
      {!clock ? (
        <Callout tone="blue" title="The 20 days have not started yet">
          <p>
            The count begins the day this load is delivered, not today. Once it is delivered you
            will have 20 days to get the signed paper copy to the branch before{' '}
            {inr(trip.podPenaltyPerDayPaise)} a day starts coming off your balance.
          </p>
          <p style={{ marginTop: 8 }}>
            You can still attach photos below at any time.
          </p>
        </Callout>
      ) : (
      <Callout tone={clock.tone} title={clock.headline}>
        Delivered {trip.deliveredAt ? dateTime(trip.deliveredAt) : '—'}. {CLOCK_RULE}
        <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
          <li style={{ marginBottom: 4 }}>
            <strong>Day 1 to day 20:</strong> nothing comes off. Your full {inr(trip.balancePaise)}{' '}
            balance is safe.
          </li>
          <li style={{ marginBottom: 4 }}>
            <strong>Day 21 onwards:</strong> {inr(trip.podPenaltyPerDayPaise)} comes off that
            balance every single day.
          </li>
          <li>
            <strong>After day 40:</strong> the whole balance is gone. You are paid nothing for this
            trip.
          </li>
        </ul>
        {clock.penaltyPaise > 0 && (
          <p style={{ marginTop: 8, fontWeight: 700, color: 'var(--red)' }}>
            {inr(clock.penaltyPaise)} will be deducted from your balance of{' '}
            {inr(trip.balancePaise)}. That grows by {inr(trip.podPenaltyPerDayPaise)} tomorrow, and
            again the day after.
          </p>
        )}
      </Callout>
      )}

      {/* The one thing that costs transporters real money when misread
          (`BR-49`, `D-35`). It is repeated here in full, in the largest tint on
          the screen, because attaching feeling like "done" is the whole problem. */}
      {!clock?.forfeited && (
        <Callout tone="flag" title="Photos alone will not stop the days counting">
          <p style={{ fontWeight: 600 }}>
            Attaching photos below only tells the branch to expect your paper. {CLOCK_STOPS_AT}
          </p>
          <p style={{ marginTop: 8 }}>
            So do both today: attach the photos here, and put the signed paper in the courier the
            same day. Until that paper is in the branch&rsquo;s hand, the days keep counting and{' '}
            {inr(trip.podPenaltyPerDayPaise)} keeps coming off after day 20.
          </p>
        </Callout>
      )}

      {trip.podStatus === 'REJECTED' && trip.podRejectionReason && (
        <Callout tone="red" title={`Rejected — ${trip.podRejectionReason}`}>
          <p>
            The branch could not accept the copy you sent, so this trip still counts as unpaid.
            Fix the point above on the paper and send a fresh signed copy.
          </p>
          <p style={{ marginTop: 8, fontWeight: 600 }}>
            The days have not stopped counting. They have been running since delivery on{' '}
            {trip.deliveredAt ? dateTime(trip.deliveredAt) : '—'}.
          </p>
        </Callout>
      )}

      {/* The chain — steps, not owners. */}
      <div className="card">
        <p className="card-title" style={{ marginBottom: 2 }}>
          The four steps to being paid
        </p>
        <p className="muted" style={{ marginBottom: 10 }}>
          Filled dots are done. You control the first one; the branch does the rest.
        </p>
        {CHAIN.map(([step, why], i) => (
          <div key={step} style={{ display: 'flex', gap: 10, padding: '6px 0' }}>
            <span
              style={{
                width: 10,
                height: 10,
                marginTop: 7,
                borderRadius: 999,
                flexShrink: 0,
                border: `2px solid ${i < chainDone ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'}`,
                background: i < chainDone ? 'var(--color-accent-700)' : 'transparent',
              }}
            />
            <span style={{ fontSize: 15, opacity: i < chainDone ? 1 : 0.7 }}>
              {i + 1}. {step}
              <span className="muted" style={{ display: 'block' }}>
                {why}
              </span>
            </span>
          </div>
        ))}
      </div>

      {clock?.forfeited ? (
        <EmptyState
          title="Nothing more can be attached to this trip"
          what={`More than 40 days have passed since delivery, so the balance of ${inr(trip.balancePaise)} is no longer payable and this form is closed.`}
          next="If your branch did receive the paper copy inside the 40 days, call them with the courier docket number — only they can correct the record."
        />
      ) : (
        <>
          <div className="card">
            <p className="card-title" style={{ marginBottom: 2 }}>
              1. Photograph the signed paper
            </p>
            <label className="muted" htmlFor="files">
              Every page of the signed POD — photo or PDF, up to 10 MB each. Make sure the
              consignee&rsquo;s stamp and signature are readable.
            </label>
            <input
              id="files"
              className="field"
              style={{ marginTop: 6 }}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                {files.map((f) => (
                  <li key={f.name} className="muted">
                    {f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB
                  </li>
                ))}
              </ul>
            )}
            {oversize && (
              <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 6 }}>
                {oversize.name} is over 10 MB. Attach a smaller copy.
              </p>
            )}
          </div>

          <div className="card">
            <p className="card-title" style={{ marginBottom: 2 }}>
              2. Courier the paper and enter the docket number
            </p>
            <label className="muted" htmlFor="docket">
              The number printed on the receipt the courier gave you
            </label>
            <input
              id="docket"
              className="field"
              style={{ marginTop: 6, fontFamily: 'ui-monospace, Menlo, monospace' }}
              value={docket}
              onChange={(e) => setDocket(e.target.value)}
            />
            <p className="muted" style={{ marginTop: 6 }}>
              The branch uses this to match the physical copy when it arrives — without it your
              paper can sit unmatched while the days keep counting.
            </p>
          </div>

          <div className="card">
            <label className="muted" htmlFor="sentOn">
              The day you handed the paper to the courier
            </label>
            <input
              id="sentOn"
              className="field"
              style={{ marginTop: 6 }}
              type="date"
              max={today()}
              value={sentOn}
              onChange={(e) => setSentOn(e.target.value)}
            />
          </div>

          <div className="card">
            <label className="muted" htmlFor="note">
              Anything noted on the POD (optional)
            </label>
            <textarea
              id="note"
              className="field"
              style={{ marginTop: 6, minHeight: 80 }}
              placeholder="Shortage, damage, detention hours"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="muted" style={{ marginTop: 6 }}>
              If the consignee wrote a shortage, damage or waiting hours on the paper, type it
              here. The branch can then add it as a charge when they check your copy.
            </p>
          </div>

          <ActionBar
            label={sending ? 'Sending…' : 'Attach proof of delivery'}
            disabled={!valid || sending}
            note={
              !files.length
                ? 'Attach at least one page of the signed paper first'
                : !docket.trim()
                  ? 'Courier docket number is required — it is how the branch finds your paper'
                  : 'Attaching starts the branch queue, not the clock — the paper still has to reach them'
            }
            onClick={submit}
          />
        </>
      )}

      <TabBar />
    </main>
  );
}
