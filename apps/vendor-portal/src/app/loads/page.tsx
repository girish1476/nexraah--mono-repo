'use client';

import Link from 'next/link';
import { useAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { AppHeader, EmptyState, ErrorNote, Loading, Pill, ScreenHeader, TabBar } from '@/components/shell';
import { inr, inrRange, dateTime } from '@/lib/format';
import { LOAD_TONE } from '@/lib/status';
import { loadTypeFilterAtom } from '@/store/atoms';
import { getLoads } from './apis';
import { Load, TRUCK_TYPES, TruckType } from './types';

export default function LoadsPage() {
  const [types, setTypes] = useAtom(loadTypeFilterAtom);
  const [loads, setLoads] = useState<Load[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setLoads(null);
    getLoads(types)
      .then(setLoads)
      .catch((e) => setError(e.message));
  }, [types]);

  const toggle = (t: TruckType) =>
    setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t]);

  return (
    <main className="screen">
      <AppHeader />
      <ScreenHeader
        title="Available loads"
        sub={types.length ? `Showing ${types.length} truck type${types.length > 1 ? 's' : ''}` : 'Showing all truck types'}
        what="Loads that need a truck, matched to the truck types you run. Open one to see the full details and send your price."
        right={
          <button
            onClick={() => setSheetOpen((o) => !o)}
            className="tap"
            style={{
              border: '1px solid var(--color-divider)',
              background: 'var(--color-surface)',
              borderRadius: 999,
              padding: '6px 12px',
              fontSize: 13,
            }}
          >
            Filters ({types.length})
          </button>
        }
      />

      {sheetOpen && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TRUCK_TYPES.map((t) => {
              const on = types.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggle(t)}
                  className="tap"
                  style={{
                    borderRadius: 999,
                    padding: '6px 14px',
                    fontSize: 13,
                    border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-divider)'}`,
                    background: on ? 'var(--color-accent)' : 'transparent',
                    color: on ? '#fff' : 'var(--color-text)',
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Pick the truck types you run. With none picked you see every load.
          </p>
          <button
            onClick={() => setTypes([])}
            className="tap"
            style={{
              marginTop: 6,
              background: 'none',
              border: 'none',
              color: 'var(--color-accent-700)',
              fontSize: 13,
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {error && <ErrorNote message={error} />}
      {!loads && !error && <Loading />}
      {loads?.length === 0 &&
        (types.length ? (
          <EmptyState
            title="No loads match those truck types right now."
            what="Loads for the truck types you picked will show up here as soon as one is posted."
            next="Turn off a filter to see more loads, or check again later."
            action={
              <button
                onClick={() => setTypes([])}
                className="tap"
                style={{
                  border: '1px solid var(--color-accent)',
                  background: 'var(--color-surface)',
                  borderRadius: 'var(--radius-pill)',
                  padding: '10px 18px',
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'var(--color-accent-700)',
                }}
              >
                Show loads of every truck type
              </button>
            }
          />
        ) : (
          <EmptyState
            title="No loads open right now"
            what="Every load that needs a truck shows up on this screen, newest first."
            next="Nothing to do — open this screen again later today to see new loads."
          />
        ))}

      {loads?.map((l) => (
        <Link key={l.code} href={`/loads/${l.code}`} className="card">
          <div className="row-between">
            <span className="card-title">
              {l.originCity} → {l.destinationCity}
            </span>
            <Pill
              tone={LOAD_TONE(!!l.myQuote)}
              reason={l.myQuote ? undefined : 'You have not sent a price for this load yet'}
            >
              {l.myQuote ? 'Quoted' : 'Open'}
            </Pill>
          </div>
          <p className="muted">
            {l.truckType} · {l.weightKg / 1000} MT {l.goods}
            {l.distanceKm !== null && ` · ${l.distanceKm.toLocaleString('en-IN')} km`}
          </p>
          <div className="row-between" style={{ marginTop: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              Quote {inrRange(l.bandLowPaise, l.bandHighPaise)}
            </span>
            <span className="muted">Pickup {dateTime(l.pickupAt)}</span>
          </div>
          {l.myQuote && (
            <p className="muted" style={{ marginTop: 6 }}>
              You quoted {inr(l.myQuote.amountPaise)}
              {l.myQuote.status === 'PENDING_APPROVAL'
                ? ' — above the range, so a Nexraah manager has to approve it before it can win.'
                : ' — waiting for a decision.'}
            </p>
          )}
        </Link>
      ))}

      <TabBar />
    </main>
  );
}
