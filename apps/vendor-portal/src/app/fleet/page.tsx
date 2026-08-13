'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AccountLink,
  ErrorNote,
  Loading,
  Pill,
  ScreenHeader,
  Segmented,
  TabBar,
} from '@/components/shell';
import { TRUCK_TYPES, TruckType } from '@/app/loads/types';
import { VEHICLE_TONE } from '@/lib/status';
import { addVehicle, getFleet, updateVehicle } from './apis';
import { FleetVehicle, SETTABLE_STATUSES, VEHICLE_STATUS_LABEL } from './types';

const STATUS_OPTIONS = SETTABLE_STATUSES.map((s) => VEHICLE_STATUS_LABEL[s]) as [
  string,
  ...string[],
];

const statusFromLabel = (label: string) =>
  SETTABLE_STATUSES.find((s) => VEHICLE_STATUS_LABEL[s] === label)!;

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
    addVehicle({
      registrationNo: registrationNo.trim().toUpperCase(),
      truckType,
      capacityKg: Math.round(Number(capacityTonnes) * 1000),
      currentCity: currentCity.trim() || undefined,
      status,
      freeFrom: status === 'ON_TRIP' ? freeFrom : undefined,
    })
      .then(() => {
        setAdding(false);
        setRegistrationNo('');
        setCapacityTonnes('');
        setCurrentCity('');
        setFreeFrom('');
        setSaving(false);
        load();
      })
      .catch((e) => {
        setError(e.message);
        setSaving(false);
      });
  };

  const setVehicleStatus = (v: FleetVehicle, label: string) => {
    const next = statusFromLabel(label);
    updateVehicle(v.id, {
      status: next,
      freeFrom: next === 'ON_TRIP' ? (v.freeFrom ?? undefined) : undefined,
    })
      .then(load)
      .catch((e) => setError(e.message));
  };

  return (
    <main className="screen">
      <ScreenHeader
        title="Fleet"
        sub="Keep this current — loads are matched against it"
        right={<AccountLink />}
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
          <label className="muted" htmlFor="reg">
            Registration
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
            Current city (optional)
          </label>
          <input
            id="city"
            className="field"
            style={{ marginTop: 6 }}
            value={currentCity}
            onChange={(e) => setCurrentCity(e.target.value)}
          />

          <p className="muted" style={{ marginTop: 12, marginBottom: 6 }}>
            Status
          </p>
          <Segmented options={STATUS_OPTIONS} value={statusLabel} onChange={setStatusLabel} />
          <p className="muted" style={{ marginTop: 6 }}>
            Docs due is set by us when a paper lapses — it is not yours to choose.
          </p>

          {status === 'ON_TRIP' && (
            <>
              <label className="muted" htmlFor="free" style={{ display: 'block', marginTop: 12 }}>
                Free from
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
        <p className="muted">No trucks yet. Add one and loads will start matching.</p>
      )}

      {fleet?.map((v) => (
        <div key={v.id} className="card">
          <div className="row-between">
            <span className="card-title" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {v.registrationNo}
            </span>
            <Pill tone={VEHICLE_TONE[v.status]}>{VEHICLE_STATUS_LABEL[v.status]}</Pill>
          </div>
          <p className="muted">
            {v.truckType} · {v.capacityKg / 1000} MT{v.currentCity ? ` · ${v.currentCity}` : ''}
            {v.status === 'ON_TRIP' && v.freeFrom ? ` · free from ${v.freeFrom}` : ''}
          </p>

          {v.docsDue ? (
            <div
              style={{
                marginTop: 10,
                background: 'var(--flag-t)',
                borderRadius: 10,
                padding: 10,
                fontSize: 13,
              }}
            >
              <strong style={{ color: 'var(--flag)' }}>{v.docsDue.documentLabel}</strong> expired{' '}
              {v.docsDue.expiredOn}. Re-upload it in <Link href="/profile">Profile</Link> to make
              this truck available again.
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
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
