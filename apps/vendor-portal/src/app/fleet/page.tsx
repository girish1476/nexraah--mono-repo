'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppHeader,
  EmptyState,
  ErrorNote,
  Loading,
  Pill,
  ScreenHeader,
  Segmented,
  TabBar,
} from '@/components/shell';
import { TRUCK_TYPES, TruckType } from '@/app/loads/types';
import { capitalizeWords } from '@/lib/format';
import { CITIES } from '@/lib/geo';
import { VEHICLE_TONE } from '@/lib/status';
import { newIdempotencyKey } from '@/apis';
import { addVehicle, getFleet, updateVehicle } from './apis';
import {
  FleetVehicle,
  SETTABLE_STATUSES,
  VEHICLE_STATUS_LABEL,
  VehicleStatus,
} from './types';

const STATUS_OPTIONS = SETTABLE_STATUSES.map((s) => VEHICLE_STATUS_LABEL[s]) as [
  string,
  ...string[],
];

const statusFromLabel = (label: string) =>
  SETTABLE_STATUSES.find((s) => VEHICLE_STATUS_LABEL[s] === label)!;

/**
 * One plain sentence per status. `DOCS_DUE` is the one a transporter cannot
 * set or clear (part 04 §2) and the top source of "the app is broken" calls,
 * so its line says who set it and points at the card below.
 * Note: never say "free from" here — the fleet spec asserts that phrase
 * appears exactly once, on the ON_TRIP spec line.
 */
const VEHICLE_STATUS_REASON: Record<VehicleStatus, string> = {
  AVAILABLE: 'Free to take a load. Loads that suit this truck are offered to you.',
  ON_TRIP: 'Carrying a load right now, so it is not offered another one.',
  DOCS_DUE: 'Set by Nexraah, not by you. Read the box below to clear it.',
  MAINTENANCE: 'You set this truck aside. It is offered no loads until you mark it Available.',
};

export default function FleetPage() {
  const [fleet, setFleet] = useState<FleetVehicle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [registrationNo, setRegistrationNo] = useState('');
  const [truckType, setTruckType] = useState<TruckType>(TRUCK_TYPES[0]);
  const [capacityTonnes, setCapacityTonnes] = useState('');
  const [currentCity, setCurrentCity] = useState('');
  const [statusLabel, setStatusLabel] = useState(VEHICLE_STATUS_LABEL.AVAILABLE);
  const [freeFrom, setFreeFrom] = useState('');
  const [saving, setSaving] = useState(false);
  // Stable across a retry of the same "add" submission; regenerated once that
  // submission succeeds, so the next truck added gets a key of its own.
  const [addKey, setAddKey] = useState(newIdempotencyKey);
  // One key per vehicle id for status updates, on the same reuse-until-success
  // rule as `addKey` — see quotes/page.tsx's withdrawKeys for the same pattern.
  const statusKeys = useRef(new Map<string, string>());
  const keyForStatusUpdate = (id: string) => {
    let key = statusKeys.current.get(id);
    if (!key) {
      key = newIdempotencyKey();
      statusKeys.current.set(id, key);
    }
    return key;
  };

  const load = useCallback(() => {
    getFleet()
      .then(setFleet)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const status = statusFromLabel(statusLabel);
  const valid =
    registrationNo.trim() !== '' &&
    Number(capacityTonnes) > 0 &&
    (status !== 'ON_TRIP' || freeFrom !== '');

  const save = () => {
    if (!valid) return;
    setSaving(true);
    addVehicle(
      {
        registrationNo: registrationNo.trim().toUpperCase(),
        truckType,
        capacityKg: Math.round(Number(capacityTonnes) * 1000),
        currentCity: currentCity.trim() || undefined,
        status,
        freeFrom: status === 'ON_TRIP' ? freeFrom : undefined,
      },
      addKey,
    )
      .then(() => {
        setAdding(false);
        setRegistrationNo('');
        setCapacityTonnes('');
        setCurrentCity('');
        setFreeFrom('');
        setSaving(false);
        setAddKey(newIdempotencyKey());
        load();
      })
      .catch((e) => {
        setError(e.message);
        setSaving(false);
      });
  };

  const setVehicleStatus = (v: FleetVehicle, label: string) => {
    const next = statusFromLabel(label);
    updateVehicle(
      v.id,
      {
        status: next,
        freeFrom: next === 'ON_TRIP' ? (v.freeFrom ?? undefined) : undefined,
      },
      keyForStatusUpdate(v.id),
    )
      .then(() => {
        statusKeys.current.delete(v.id);
        load();
      })
      .catch((e) => setError(e.message));
  };

  return (
    <main className="screen">
      <AppHeader />
      <ScreenHeader
        title="Fleet"
        sub="Your trucks"
        what="The trucks you run. Nexraah only offers you loads that suit a truck on this list, so keep it correct."
      />

      {error && <ErrorNote message={error} />}

      <button
        onClick={() => setAdding((a) => !a)}
        style={{
          width: '100%',
          borderRadius: 10,
          padding: '12px',
          marginBottom: 10,
          background: adding ? 'var(--color-surface)' : 'var(--color-accent)',
          color: adding ? 'var(--color-text)' : '#fff',
          border: `1px solid ${adding ? 'var(--color-divider)' : 'var(--color-accent)'}`,
        }}
      >
        {adding ? 'Cancel' : 'Add a truck'}
      </button>

      {adding && (
        <div className="card">
          <p style={{ fontSize: 15.5, lineHeight: 1.5, marginBottom: 12 }}>
            Add a truck so loads that suit it are offered to you. You can change all of this
            later.
          </p>
          <label className="muted" htmlFor="reg">
            Number plate
          </label>
          <input
            id="reg"
            className="field"
            style={{ marginTop: 6, textTransform: 'uppercase' }}
            placeholder="MH 15 GT 4482"
            value={registrationNo}
            onChange={(e) => setRegistrationNo(e.target.value)}
          />

          <label className="muted" htmlFor="type" style={{ display: 'block', marginTop: 12 }}>
            Vehicle type
          </label>
          <select
            id="type"
            className="field"
            style={{ marginTop: 6 }}
            value={truckType}
            onChange={(e) => setTruckType(e.target.value as TruckType)}
          >
            {TRUCK_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>

          <label className="muted" htmlFor="cap" style={{ display: 'block', marginTop: 12 }}>
            Capacity (tonnes)
          </label>
          <input
            id="cap"
            className="field"
            style={{ marginTop: 6 }}
            inputMode="decimal"
            value={capacityTonnes}
            onChange={(e) => setCapacityTonnes(e.target.value.replace(/[^0-9.]/g, ''))}
          />

          <label className="muted" htmlFor="city" style={{ display: 'block', marginTop: 12 }}>
            Where the truck is now (you can leave this empty)
          </label>
          <input
            id="city"
            list="cities-current-city"
            autoComplete="off"
            className="field"
            style={{ marginTop: 6 }}
            value={currentCity}
            onChange={(e) => setCurrentCity(e.target.value)}
            onBlur={(e) => setCurrentCity(capitalizeWords(e.target.value))}
          />
          <datalist id="cities-current-city">
            {CITIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <p className="muted" style={{ marginTop: 12, marginBottom: 6 }}>
            What is this truck doing now?
          </p>
          <Segmented options={STATUS_OPTIONS} value={statusLabel} onChange={setStatusLabel} />
          <p className="muted" style={{ marginTop: 6 }}>
            Docs due is missing from this list on purpose. Nexraah sets it when one of the truck&apos;s
            papers runs out, and only re-uploading that paper in Profile clears it.
          </p>

          {status === 'ON_TRIP' && (
            <>
              <label className="muted" htmlFor="free" style={{ display: 'block', marginTop: 12 }}>
                Date this truck is free again (needed for On trip)
              </label>
              <input
                id="free"
                className="field"
                style={{ marginTop: 6 }}
                type="date"
                value={freeFrom}
                onChange={(e) => setFreeFrom(e.target.value)}
              />
            </>
          )}

          <button
            onClick={save}
            disabled={!valid || saving}
            style={{
              width: '100%',
              marginTop: 14,
              borderRadius: 10,
              padding: '12px',
              border: 'none',
              fontWeight: 600,
              background: valid ? 'var(--color-accent)' : 'var(--color-neutral-300)',
              color: valid ? '#fff' : 'var(--color-neutral-700)',
            }}
          >
            {saving ? 'Saving…' : 'Save truck'}
          </button>
        </div>
      )}

      {!fleet && !error && <Loading />}
      {fleet?.length === 0 && (
        <EmptyState
          title="No trucks added yet"
          what="Each truck you add shows here with what it is doing today — free, on a load, or off the road."
          next="Tap Add a truck at the top and fill in the number plate, type and capacity."
          action={
            <button
              onClick={() => setAdding(true)}
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
              Add your first truck
            </button>
          }
        />
      )}

      {fleet?.map((v) => (
        <div key={v.id} className="card">
          <div className="row-between">
            <span className="card-title" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {v.registrationNo}
            </span>
            <Pill tone={VEHICLE_TONE[v.status]} reason={VEHICLE_STATUS_REASON[v.status]}>
              {VEHICLE_STATUS_LABEL[v.status]}
            </Pill>
          </div>
          <p className="muted">
            {v.truckType} · {v.capacityKg / 1000} MT{v.currentCity ? ` · ${v.currentCity}` : ''}
            {v.status === 'ON_TRIP' && v.freeFrom ? ` · free from ${v.freeFrom}` : ''}
          </p>

          {v.docsDue ? (
            /* DOCS_DUE is server-set (part 04 §2). The transporter cannot pick a
               different status to escape it, so the card says which paper, where
               to fix it, and that no status buttons are missing by mistake. */
            <div
              style={{
                marginTop: 10,
                background: 'var(--flag-t)',
                borderRadius: 10,
                padding: 12,
                fontSize: 15,
                lineHeight: 1.5,
              }}
            >
              <p style={{ fontWeight: 700, color: 'var(--flag)' }}>
                One paper for this truck has run out
              </p>
              <p style={{ marginTop: 6 }}>
                <strong>{v.docsDue.documentLabel}</strong> expired {v.docsDue.expiredOn}. Until a
                valid one is on file, this truck is not offered any loads.
              </p>
              <p style={{ marginTop: 8 }}>
                Re-upload it in <Link href="/profile">Profile</Link> to make this truck available
                again. The status clears by itself once the new paper is checked.
              </p>
              <p style={{ marginTop: 8, fontWeight: 600 }}>
                The status buttons are hidden on purpose. Nexraah sets this one, so changing the
                status here would not fix anything — only the new paper will.
              </p>
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              <p className="muted" style={{ marginBottom: 6 }}>
                Tap what this truck is doing now:
              </p>
              <Segmented
                options={STATUS_OPTIONS}
                value={VEHICLE_STATUS_LABEL[v.status]}
                onChange={(label) => setVehicleStatus(v, label)}
              />
            </div>
          )}
        </div>
      ))}

      <TabBar />
    </main>
  );
}
