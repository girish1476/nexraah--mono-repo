'use client';

import Link from 'next/link';
import { useAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { ErrorNote, Loading, Pill, ScreenHeader, TabBar } from '@/components/shell';
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
      <ScreenHeader
        title="Available loads"
        sub="Matched to your fleet and lanes"
        right={
          <button
            onClick={() => setSheetOpen((o) => !o)}
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
          <button
            onClick={() => setTypes([])}
            style={{
              marginTop: 10,
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
      {loads?.length === 0 && (
        <p className="muted">No loads match those truck types right now.</p>
      )}

      {loads?.map((l) => (
        <Link key={l.code} href={`/loads/${l.code}`} className="card">
          <div className="row-between">
            <span className="card-title">
              {l.originCity} → {l.destinationCity}
            </span>
            <Pill tone={LOAD_TONE(!!l.myQuote)}>{l.myQuote ? 'Quoted' : 'Open'}</Pill>
          </div>
          <p className="muted">
            {l.truckType} · {l.weightKg / 1000} MT {l.goods} · {l.distanceKm.toLocaleString('en-IN')} km
          </p>
          <div className="row-between" style={{ marginTop: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {inrRange(l.bandLowPaise, l.bandHighPaise)}
            </span>
            <span className="muted">Pickup {dateTime(l.pickupAt)}</span>
          </div>
          {l.myQuote && (
            <p className="muted" style={{ marginTop: 6 }}>
              You quoted {inr(l.myQuote.amountPaise)}
            </p>
          )}
        </Link>
      ))}

      <TabBar />
    </main>
  );
}
