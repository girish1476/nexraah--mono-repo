'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ActionBar, AppHeader, ErrorNote, Facts, Loading, ScreenHeader, TabBar } from '@/components/shell';
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
      <AppHeader />
        <ScreenHeader
          title={params.code}
          what="This load did not open. Nothing you have already quoted or booked is affected."
          back="Loads"
        />
        <ErrorNote message={error} />
        <TabBar />
      </main>
    );
  }
  if (!load) {
    return (
      <main className="screen">
      <AppHeader />
        <ScreenHeader
          title={params.code}
          what="Getting the details of this load and the price range you can quote."
          back="Loads"
        />
        <Loading />
        <TabBar />
      </main>
    );
  }

  return (
    <main className="screen">
      <AppHeader />
      <ScreenHeader
        title={load.code}
        sub={`${load.originCity} → ${load.destinationCity}`}
        what="Everything about this load, so you can decide your price. If it suits your truck, send your quote from the button at the bottom."
        back="Loads"
      />

      <div className="card">
        <p className="muted">Bid band — the price range for this load</p>
        <p style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-heading)' }}>
          {inrRange(load.bandLowPaise, load.bandHighPaise)}
        </p>
        <p style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5 }}>
          Quote anywhere inside this range and your price goes in as it is.
        </p>
        <p style={{ marginTop: 10, fontSize: 15, lineHeight: 1.5, color: 'var(--red)' }}>
          Below {inr(load.bandLowPaise)}: the app will not let you send it. This is a fixed floor
          for this load.
        </p>
        <p style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5 }}>
          Above {inr(load.bandHighPaise)}: you can still send it, but it is not accepted straight
          away — a Nexraah manager has to approve it first, so you wait longer for an answer.
        </p>
      </div>

      <Facts
        rows={[
          ['Truck type', load.truckType],
          ['Weight', `${load.weightKg / 1000} MT`],
          ['Goods', load.goods],
          [
            'Distance',
            load.distanceKm === null
              ? 'Not recorded'
              : `${load.distanceKm.toLocaleString('en-IN')} km`,
          ],
          [
            'Time allowed for transit',
            load.transitDays === null ? 'Not specified' : `${load.transitDays} days`,
          ],
          [
            'When to report',
            load.reportingRule === null ? 'Not specified' : REPORTING_LABEL[load.reportingRule],
          ],
          ['Pickup', dateTime(load.pickupAt)],
          ['Advance paid up front', `${load.advancePct}% of freight`],
        ]}
      />

      {load.remarks && (
        <div className="card">
          <p className="muted">Instructions for this load — follow these exactly</p>
          <p>{load.remarks}</p>
        </div>
      )}

      <p className="muted">
        If your truck does not reach the pickup point at the reporting time, it is counted as a
        delay against you.
      </p>

      {load.myQuote ? (
        <ActionBar
          label={`Quoted ${inr(load.myQuote.amountPaise)}`}
          note="You have already quoted this load. Go to the Quotes tab to follow it or take it back."
          disabled
          onClick={() => {}}
        />
      ) : (
        <ActionBar
          label="Quote this load"
          note={`Quote inside ${inrRange(load.bandLowPaise, load.bandHighPaise)} for a straight answer`}
          onClick={() => router.push(`/loads/${load.code}/quote`)}
        />
      )}

      <TabBar />
    </main>
  );
}
