'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ActionBar, ErrorNote, Facts, Loading, ScreenHeader, TabBar } from '@/components/shell';
import { inr, inrRange, dateTime } from '@/lib/format';
import { getLoad } from '../apis';
import { Load, REPORTING_LABEL } from '../types';

export default function LoadDetailPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLoad(params.code)
      .then(setLoad)
      .catch((e) => setError(e.message));
  }, [params.code]);

  if (error) {
    return (
      <main className="screen">
        <ScreenHeader title={params.code} back="Loads" />
        <ErrorNote message={error} />
        <TabBar />
      </main>
    );
  }
  if (!load) {
    return (
      <main className="screen">
        <ScreenHeader title={params.code} back="Loads" />
        <Loading />
        <TabBar />
      </main>
    );
  }

  return (
    <main className="screen">
      <ScreenHeader
        title={load.code}
        sub={`${load.originCity} → ${load.destinationCity}`}
        back="Loads"
      />

      <div className="card">
        <p className="muted">Bid band</p>
        <p style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-heading)' }}>
          {inrRange(load.bandLowPaise, load.bandHighPaise)}
        </p>
        <p className="muted" style={{ marginTop: 6 }}>
          Quote below {inr(load.bandLowPaise)} and it is refused at entry. Above{' '}
          {inr(load.bandHighPaise)} it still goes, but the award waits on approval.
        </p>
      </div>

      <Facts
        rows={[
          ['Truck type', load.truckType],
          ['Weight', `${load.weightKg / 1000} MT`],
          ['Goods', load.goods],
          ['Distance', `${load.distanceKm.toLocaleString('en-IN')} km`],
          ['Transit required', `${load.transitDays} days`],
          ['Reporting', REPORTING_LABEL[load.reportingRule]],
          ['Pickup', dateTime(load.pickupAt)],
          ['Advance on offer', `${load.advancePct}% of freight`],
        ]}
      />

      {load.remarks && (
        <div className="card">
          <p className="muted">Remarks</p>
          <p>{load.remarks}</p>
        </div>
      )}

      <p className="muted">
        Missing the reporting time counts as a transit delay against you.
      </p>

      {load.myQuote ? (
        <ActionBar
          label={`Quoted ${inr(load.myQuote.amountPaise)}`}
          note="Open My quotes to withdraw or track it"
          disabled
          onClick={() => {}}
        />
      ) : (
        <ActionBar
          label="Quote this load"
          note={`Band ${inrRange(load.bandLowPaise, load.bandHighPaise)}`}
          onClick={() => router.push(`/loads/${load.code}/quote`)}
        />
      )}

      <TabBar />
    </main>
  );
}
