'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ActionBar, Callout, ErrorNote, Loading, ScreenHeader, TabBar } from '@/components/shell';
import { inr, dateTime } from '@/lib/format';
import { attachPod, getTrip } from '../../apis';
import { CLOCK_RULE, CLOCK_STOPS_AT, podClock } from '../../pod-clock';
import { Trip } from '../../types';

const MAX_BYTES = 10 * 1024 * 1024;
const CHAIN = ['Attach (you)', 'Received (branch)', 'Verified (branch)', 'Approved (branch)'];

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

  useEffect(() => {
    getTrip(params.id)
      .then(setTrip)
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (!trip) {
    return (
      <main className="screen">
        <ScreenHeader title="Proof of delivery" back={params.id} />
        {error ? <ErrorNote message={error} /> : <Loading />}
        <TabBar />
      </main>
    );
  }

  const clock = podClock(trip.podDaysElapsed ?? 0, trip.podPenaltyPerDayPaise);
  const chainDone =
    trip.podStatus === 'APPROVED' ? 4 : trip.podStatus === 'VERIFIED' ? 3 : trip.podStatus === 'RECEIVED' ? 2 : trip.podStatus === 'ATTACHED' ? 1 : 0;

  const oversize = files.find((f) => f.size > MAX_BYTES);
  const valid =
    files.length > 0 && !oversize && docket.trim() !== '' && sentOn !== '' && sentOn <= today();

  const submit = () => {
    if (!valid) return;
    setSending(true);
    attachPod(trip.id, { files, courierDocketNo: docket.trim(), sentOn, note: note.trim() })
      .then(() => router.push(`/trips/${trip.id}`))
      .catch((e) => {
        setError(e.message);
        setSending(false);
      });
  };

  return (
    <main className="screen">
      <ScreenHeader
        title="Proof of delivery"
        sub={`${trip.id} · ${trip.originCity} → ${trip.destinationCity}`}
        back={trip.id}
      />

      {error && <ErrorNote message={error} />}

      {/* The chain — steps, not owners. */}
      <div className="card">
        {CHAIN.map((step, i) => (
          <div key={step} style={{ display: 'flex', gap: 10, padding: '5px 0' }}>
            <span
              style={{
                width: 10,
                height: 10,
                marginTop: 6,
                borderRadius: 999,
                flexShrink: 0,
                border: `2px solid ${i < chainDone ? 'var(--color-accent-700)' : 'var(--color-neutral-400)'}`,
                background: i < chainDone ? 'var(--color-accent-700)' : 'transparent',
              }}
            />
            <span style={{ fontSize: 14, opacity: i < chainDone ? 1 : 0.55 }}>{step}</span>
          </div>
        ))}
      </div>

      {trip.podStatus === 'REJECTED' && trip.podRejectionReason && (
        <Callout tone="red" title={`Rejected — ${trip.podRejectionReason}`}>
          Send a replacement copy. The penalty clock has not stopped; it has been running since
          delivery on {trip.deliveredAt ? dateTime(trip.deliveredAt) : '—'}.
        </Callout>
      )}

      {/* The clock. */}
      <Callout tone={clock.tone} title={clock.headline}>
        Delivered {trip.deliveredAt ? dateTime(trip.deliveredAt) : '—'}. {CLOCK_RULE}
        <p style={{ marginTop: 6, fontWeight: 500 }}>{CLOCK_STOPS_AT}</p>
        {clock.penaltyPaise > 0 && (
          <p className="muted" style={{ marginTop: 6 }}>
            {inr(clock.penaltyPaise)} will be deducted from your balance of{' '}
            {inr(trip.balancePaise)}.
          </p>
        )}
      </Callout>

      {clock.forfeited ? (
        <p className="muted">
          Nothing further can be attached against this trip. Speak to your branch if you believe
          the paper copy was delivered in time.
        </p>
      ) : (
        <>
          <div className="card">
            <label className="muted" htmlFor="files">
              Every page of the signed POD — photo or PDF, up to 10 MB each
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
            <label className="muted" htmlFor="docket">
              Courier docket number
            </label>
            <input
              id="docket"
              className="field"
              style={{ marginTop: 6, fontFamily: 'ui-monospace, Menlo, monospace' }}
              value={docket}
              onChange={(e) => setDocket(e.target.value)}
            />
            <p className="muted" style={{ marginTop: 6 }}>
              The branch uses this to match the physical copy when it arrives.
            </p>
          </div>

          <div className="card">
            <label className="muted" htmlFor="sentOn">
              Sent on
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
              Written here, it reaches the branch as a charge at verification.
            </p>
          </div>

          <ActionBar
            label={sending ? 'Sending…' : 'Attach proof of delivery'}
            disabled={!valid || sending}
            note={
              !files.length
                ? 'Attach at least one page'
                : !docket.trim()
                  ? 'Courier docket number is required'
                  : 'Attaching starts the branch queue, not the clock'
            }
            onClick={submit}
          />
        </>
      )}

      <TabBar />
    </main>
  );
}
