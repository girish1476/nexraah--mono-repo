'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  ActionBar,
  Callout,
  ErrorNote,
  Loading,
  ScreenHeader,
  Segmented,
  TabBar,
} from '@/components/shell';
import { inr, inrRange } from '@/lib/format';
import { BAND_TONE } from '@/lib/status';
import { getLoad, getQuotableVehicles, placeQuote } from '../../apis';
import { Load, REPORTING_LABEL, ReportingRule, Vehicle } from '../../types';

const REPORTING_OPTIONS = ['Same day', 'Next day', 'Scheduled'] as const;
const REPORTING_VALUE: Record<(typeof REPORTING_OPTIONS)[number], ReportingRule> = {
  'Same day': 'SAME_DAY',
  'Next day': 'NEXT_DAY',
  Scheduled: 'SCHEDULED',
};

export default function QuoteFormPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rupees, setRupees] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [reporting, setReporting] =
    useState<(typeof REPORTING_OPTIONS)[number]>('Same day');
  const [sending, setSending] = useState(false);

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
      .then((v) => {
        setVehicles(v);
        setVehicleId(v[0]?.id ?? '');
      })
      .catch((e) => setError(e.message));
  }, [params.code]);

  const amountPaise = (Number(rupees) || 0) * 100;

  const verdict = useMemo(() => {
    if (!load || !amountPaise) return null;
    const isBelow = amountPaise < load.bandLowPaise;
    const isAbove = amountPaise > load.bandHighPaise;
    return {
      tone: BAND_TONE(isBelow, isAbove),
      title: isBelow ? 'Below the band' : isAbove ? 'Above the band' : 'Within the band',
      note: isBelow
        ? `Nexraah will not award this lane below ${inr(load.bandLowPaise)} — it would run at a loss for you and for the desk.`
        : isAbove
          ? 'You can still send it. The award will wait on approval and usually loses to an in-band quote.'
          : 'The placement desk can award this to you without any approval.',
    };
  }, [load, amountPaise]);

  const below = !!load && amountPaise > 0 && amountPaise < load.bandLowPaise;

  const submit = () => {
    if (!load || below || !amountPaise || !vehicleId) return;
    setSending(true);
    placeQuote(load.code, {
      amountPaise,
      vehicleId,
      reportingRule: REPORTING_VALUE[reporting],
    })
      .then(() => router.push('/quotes'))
      .catch((e) => {
        setError(e.message);
        setSending(false);
      });
  };

  if (!load) {
    return (
      <main className="screen">
        <ScreenHeader title="Place a quote" back={params.code} />
        {error ? <ErrorNote message={error} /> : <Loading />}
        <TabBar />
      </main>
    );
  }

  return (
    <main className="screen">
      <ScreenHeader
        title="Place a quote"
        sub={`${load.code} · ${load.originCity} → ${load.destinationCity}`}
        back={load.code}
      />

      {error && <ErrorNote message={error} />}

      <div className="card">
        <label className="muted" htmlFor="amount">
          Your all-in freight (₹)
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
          Band {inrRange(load.bandLowPaise, load.bandHighPaise)}
        </p>
      </div>

      {verdict && (
        <Callout tone={verdict.tone} title={verdict.title}>
          {verdict.note}
        </Callout>
      )}

      <div className="card">
        <label className="muted" htmlFor="vehicle">
          Vehicle
        </label>
        <select
          id="vehicle"
          className="field"
          style={{ marginTop: 6 }}
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
        >
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registrationNo} · {v.truckType}
            </option>
          ))}
        </select>
        {!vehicles.length && (
          <p className="muted" style={{ marginTop: 6 }}>
            No vehicle is available to quote with. Free one up under Fleet.
          </p>
        )}
      </div>

      <div className="card">
        <p className="muted" style={{ marginBottom: 8 }}>
          Reporting — asked for {REPORTING_LABEL[load.reportingRule]}
        </p>
        <Segmented
          options={REPORTING_OPTIONS}
          value={reporting}
          onChange={setReporting}
        />
      </div>

      <p className="muted">
        Advance on this lane is {load.advancePct}% of freight, released after the vehicle
        documents are verified.
      </p>

      <ActionBar
        label={sending ? 'Sending…' : `Submit quote ${inr(amountPaise)}`}
        disabled={below || !amountPaise || !vehicleId || sending}
        note={
          below
            ? `Blocked: below the published floor of ${inr(load.bandLowPaise)}`
            : amountPaise > load.bandHighPaise
              ? 'Will be sent for approval before award'
              : undefined
        }
        onClick={submit}
      />

      <TabBar />
    </main>
  );
}
