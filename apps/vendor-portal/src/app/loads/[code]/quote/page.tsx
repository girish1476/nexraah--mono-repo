'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  ActionBar,
  AppHeader,
  Callout,
  ErrorNote,
  Loading,
  ScreenHeader,
  Segmented,
  TabBar,
} from '@/components/shell';
import { inr, inrRange } from '@/lib/format';
import { BAND_TONE } from '@/lib/status';
import { newIdempotencyKey } from '@/apis';
import { getLoad, getQuotableVehicles, placeQuote } from '../../apis';
import { Load, REPORTING_LABEL, ReportingRule, Vehicle } from '../../types';

const REPORTING_OPTIONS = ['Same day', 'Next day', 'Scheduled'] as const;
const REPORTING_VALUE: Record<(typeof REPORTING_OPTIONS)[number], ReportingRule> = {
  'Same day': 'SAME_DAY',
  'Next day': 'NEXT_DAY',
  Scheduled: 'SCHEDULED',
};

const DRIVER_MOBILE_RE = /^[6-9]\d{9}$/;

export default function QuoteFormPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rupees, setRupees] = useState('');
  const [vehicleRegNo, setVehicleRegNo] = useState('');
  const [driverMobile, setDriverMobile] = useState('');
  const [driverMobileTouched, setDriverMobileTouched] = useState(false);
  const [reporting, setReporting] =
    useState<(typeof REPORTING_OPTIONS)[number]>('Same day');
  const [scheduledDate, setScheduledDate] = useState('');
  const [sending, setSending] = useState(false);
  // Minted once per mount and reused across a retry of the same submission.
  const [idempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    getLoad(params.code)
      .then((l) => {
        setLoad(l);
        setRupees(String(Math.round(l.bandLowPaise / 100)));
        setReporting(
          (Object.keys(REPORTING_VALUE) as (typeof REPORTING_OPTIONS)[number][]).find(
            (k) => REPORTING_VALUE[k] === l.reportingRule,
          ) ?? 'Same day',
        );
      })
      .catch((e) => setError(e.message));
    getQuotableVehicles()
      .then((v) => setVehicles(v))
      .catch((e) => setError(e.message));
  }, [params.code]);

  const amountPaise = (Number(rupees) || 0) * 100;
  const driverMobileError =
    driverMobileTouched && driverMobile && !DRIVER_MOBILE_RE.test(driverMobile)
      ? 'This is not a full mobile number. It needs 10 digits and must start with 6, 7, 8 or 9.'
      : null;
  const driverMobileValid = DRIVER_MOBILE_RE.test(driverMobile);

  const verdict = useMemo(() => {
    if (!load || !amountPaise) return null;
    const isBelow = amountPaise < load.bandLowPaise;
    const isAbove = amountPaise > load.bandHighPaise;
    return {
      tone: BAND_TONE(isBelow, isAbove),
      title: isBelow
        ? 'Below the band — you cannot send this price'
        : isAbove
          ? 'Above the band — goes for approval first'
          : 'Within the band — ready to send',
      note: isBelow
        ? `Nexraah will not award this lane below ${inr(load.bandLowPaise)}. Raise your price to ${inr(load.bandLowPaise)} or more before you can send it.`
        : isAbove
          ? `You can still send this price. It will not be accepted straight away — a Nexraah manager has to approve anything over ${inr(load.bandHighPaise)} first, so you wait longer for an answer.`
          : 'This price can be given to you straight away, with nobody else to approve it.',
    };
  }, [load, amountPaise]);

  const below = !!load && amountPaise > 0 && amountPaise < load.bandLowPaise;
  const canSubmit = !!load && !below && !!amountPaise && !!vehicleRegNo.trim() && driverMobileValid;

  const submit = () => {
    if (!load || !canSubmit) return;
    setSending(true);
    placeQuote(
      load.code,
      {
        amountPaise,
        vehicleRegistrationNo: vehicleRegNo.trim().toUpperCase(),
        driverMobile,
        reportingRule: REPORTING_VALUE[reporting],
        ...(reporting === 'Scheduled' && scheduledDate ? { scheduledDate } : {}),
      },
      idempotencyKey,
    )
      .then(() => router.push('/quotes'))
      .catch((e) => {
        setError(e.message);
        setSending(false);
      });
  };

  if (!load) {
    return (
      <main className="screen">
      <AppHeader />
        <ScreenHeader
          title="Place a quote"
          what="Getting this load's price range. Nothing is sent until you fill the form and press the button at the bottom."
          back={params.code}
        />
        {error ? <ErrorNote message={error} /> : <Loading />}
        <TabBar />
      </main>
    );
  }

  return (
    <main className="screen">
      <AppHeader />
      <ScreenHeader
        title="Place a quote"
        sub={`${load.code} · ${load.originCity} → ${load.destinationCity}`}
        what="Tell Nexraah your price for this load, and which truck and driver will run it. Read the two price rules below before you type an amount."
        back={load.code}
      />

      {error && <ErrorNote message={error} />}

      <div className="card">
        <p className="muted">Two price rules for this load</p>
        <p style={{ marginTop: 8, fontSize: 15.5, lineHeight: 1.5 }}>
          <strong>1. The least you can quote is {inr(load.bandLowPaise)}.</strong> Type anything
          under that and this screen will not let you send it. The floor does not move.
        </p>
        <p style={{ marginTop: 10, fontSize: 15.5, lineHeight: 1.5 }}>
          <strong>2. Over {inr(load.bandHighPaise)} it goes for approval.</strong> You may still
          send it, but a Nexraah manager has to approve the higher price before the load can be
          given to you, so the answer takes longer. Up to {inr(load.bandHighPaise)} there is no
          approval step.
        </p>
      </div>

      <div className="card">
        <label className="muted" htmlFor="amount">
          Your price for the whole trip (₹)
        </label>
        <input
          id="amount"
          className="field"
          inputMode="numeric"
          value={rupees}
          onChange={(e) => setRupees(e.target.value.replace(/[^0-9]/g, ''))}
          style={{ marginTop: 6, fontSize: 22, fontWeight: 600 }}
        />
        <p className="muted" style={{ marginTop: 8 }}>
          Quote everything in one figure — fuel, tolls, driver and loading. No amount is added on
          top later.
        </p>
        <p className="muted" style={{ marginTop: 6 }}>
          Price range for this load: {inrRange(load.bandLowPaise, load.bandHighPaise)}. The box
          starts at the lowest price you are allowed to quote.
        </p>
      </div>

      {verdict && (
        <Callout tone={verdict.tone} title={verdict.title}>
          {verdict.note}
        </Callout>
      )}

      <div className="card">
        <label className="muted" htmlFor="vehicle">
          Number plate of the truck you will send
        </label>
        <input
          id="vehicle"
          className="field"
          style={{ marginTop: 6 }}
          placeholder="e.g. MH 04 KL 9034"
          list="vehicle-suggestions"
          value={vehicleRegNo}
          onChange={(e) => setVehicleRegNo(e.target.value.toUpperCase())}
          autoComplete="off"
        />
        <datalist id="vehicle-suggestions">
          {vehicles.map((v) => (
            <option key={v.id} value={v.registrationNo}>
              {v.truckType}
            </option>
          ))}
        </datalist>
        {!vehicles.length ? (
          <p className="muted" style={{ marginTop: 6 }}>
            You have no truck saved in Fleet yet. That does not stop you — type the number plate of
            the truck you will send.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 6 }}>
            Start typing and your saved trucks appear. You can also type a truck that is not in
            your Fleet list.
          </p>
        )}
      </div>

      <div className="card">
        <label className="muted" htmlFor="driver-mobile">
          Mobile number of the driver
        </label>
        <input
          id="driver-mobile"
          className="field"
          inputMode="numeric"
          style={{ marginTop: 6 }}
          placeholder="10-digit mobile number"
          value={driverMobile}
          maxLength={10}
          onChange={(e) => setDriverMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
          onBlur={() => setDriverMobileTouched(true)}
        />
        {driverMobileError && (
          <p style={{ marginTop: 6, color: 'var(--red, #c0392b)' }}>{driverMobileError}</p>
        )}
      </div>

      <div className="card">
        <p className="muted" style={{ marginBottom: 8 }}>
          When your truck can reach the pickup point.{' '}
          {load.reportingRule
            ? `Nexraah asked for ${REPORTING_LABEL[load.reportingRule]} — you can pick something else, and the desk sees what you picked.`
            : 'Nexraah did not specify a reporting time for this load — pick what suits your truck, and the desk sees what you picked.'}
        </p>
        <Segmented
          options={REPORTING_OPTIONS}
          value={reporting}
          onChange={setReporting}
        />
        {reporting === 'Scheduled' && (
          <div style={{ marginTop: 10 }}>
            <label className="muted" htmlFor="scheduled-date">
              Pick a date (optional)
            </label>
            <input
              id="scheduled-date"
              type="date"
              className="field"
              style={{ marginTop: 6 }}
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
            {scheduledDate && (
              <p className="muted" style={{ marginTop: 6 }}>
                Scheduled for{' '}
                {new Date(`${scheduledDate}T00:00:00`).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            )}
          </div>
        )}
      </div>

      <p className="muted">
        If this load comes to you, {load.advancePct}% of your price is paid as advance. That money
        is released only after the documents for this truck are verified, so keep them up to date
        in Profile.
      </p>

      <ActionBar
        label={sending ? 'Sending…' : `Submit quote ${inr(amountPaise)}`}
        disabled={!canSubmit || sending}
        note={
          below
            ? `Blocked: below the published floor of ${inr(load.bandLowPaise)}. Raise your price to send it.`
            : amountPaise > load.bandHighPaise
              ? 'Will be sent for approval before award — this takes longer than a price inside the range'
              : undefined
        }
        onClick={submit}
      />

      <TabBar />
    </main>
  );
}
