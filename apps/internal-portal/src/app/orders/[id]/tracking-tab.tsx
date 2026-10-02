'use client';

import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '@/apis';
import { addTracking, deliverTrip, departTrip, extendEway, getTracking } from '@/app/trips/apis';
import { TRACKING_STATUS_LABEL } from '@/app/trips/types';
import type { TrackingKind, TrackingSheet, TrackingStatus, TrackingUpdate } from '@/app/trips/types';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Banner, Column, DataTable, ErrorState, Field, FormGrid, Loading, Panel, Stack, Tag, useCan, useToast } from '@/lib/ui';

/**
 * Google Maps, embedded. With `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set it uses the
 * Maps Embed API; without one, Google's plain embed — same map, no key.
 */
function mapSrc(query: string): string {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const q = encodeURIComponent(query);
  return key
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${q}&zoom=11`
    : `https://maps.google.com/maps?q=${q}&z=11&output=embed`;
}

/** The order cycle, from the moment a vehicle is allocated, in the words Operations uses. */
const STEPS: { key: string; label: string; emoji: string }[] = [
  { key: 'TO_LOADING', label: 'On the way to the loading point', emoji: '🛻' },
  { key: 'REACHED_LOADING', label: 'Reached the loading point', emoji: '📍' },
  { key: 'LOADED', label: 'Loaded', emoji: '📦' },
  { key: 'DEPARTED', label: 'On the road', emoji: '🚚' },
  { key: 'REACHED', label: 'Reached the unloading point', emoji: '🏁' },
  { key: 'UNLOADED', label: 'Unloaded', emoji: '📤' },
];

const KIND_LABEL: Record<TrackingKind, string> = {
  UPDATE: 'Position update',
  REACHED_LOADING: 'Reached the loading point',
  LOADED: 'Loaded',
  DEPARTED: 'Left for delivery',
  REACHED: 'Reached the unloading point',
  UNLOADED: 'Unloaded',
  EWAY_EXTENDED: 'E-way bill extended',
};

/** Where the order stands in the cycle — the index of the step it is on. */
function currentStep(s: TrackingSheet): number {
  if (s.deliveredAt) return 5;
  if (s.reachedDestinationAt) return 4;
  if (s.departedAt || s.stage === 'IN_TRANSIT') return 3;
  if (s.loadedAt) return 2;
  if (s.reachedLoadingAt) return 1;
  return 0;
}

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/**
 * The order's Tracking tab — the tracking sheet, from the moment a vehicle is
 * allocated until it is unloaded:
 *
 *   on the way to the loading point → reached it → loaded → (advance
 *   documents uploaded) → on the road → reached the unloading point →
 *   unloaded → (proof of delivery uploaded)
 *
 * Each milestone is one button, shown when it is the next thing to happen.
 * Between them, anyone running the trip types where the truck is; the latest
 * place shows on the map.
 */
export function OrderTrackingTab({
  tripId,
  onChanged,
  openDocuments,
}: {
  tripId: string;
  onChanged: () => void;
  openDocuments: () => void;
}) {
  const can = useCan();
  const toast = useToast();
  const [sheet, setSheet] = useState<TrackingSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<{ location: string; lat: string; lng: string; note: string; status: TrackingStatus }>({
    location: '',
    lat: '',
    lng: '',
    note: '',
    status: 'MOVING',
  });
  const [eway, setEway] = useState({ validTill: '', ewayNo: '', reason: '' });
  const [unloadedAt, setUnloadedAt] = useState(nowLocal);

  const load = () => {
    setError(null);
    getTracking(tripId)
      .then(setSheet)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [tripId]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!sheet) return <Loading what="Loading the tracking sheet" />;

  const canRun = can('indent.manage');

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast(done);
      load();
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const mark = (kind: 'REACHED_LOADING' | 'LOADED' | 'REACHED', done: string) =>
    run(() => addTracking(tripId, { kind }), done);

  const addUpdate = () => {
    const lat = update.lat.trim() ? Number(update.lat) : undefined;
    const lng = update.lng.trim() ? Number(update.lng) : undefined;
    return run(
      () =>
        addTracking(tripId, {
          kind: 'UPDATE',
          location: update.location.trim(),
          ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
          note: update.note.trim() || undefined,
          status: update.status,
        }).then((r) => {
          setUpdate({ location: '', lat: '', lng: '', note: '', status: 'MOVING' });
          return r;
        }),
      'Tracking updated',
    );
  };

  // Valid, running out within a day, or expired — judged against the end of the validity day.
  const ewayState: 'none' | 'valid' | 'expiring' | 'expired' = (() => {
    const till = sheet.eway?.uploaded ? sheet.eway.validTill : null;
    if (!till) return 'none';
    const end = new Date(`${till.slice(0, 10)}T23:59:59`).getTime();
    const left = end - Date.now();
    return left < 0 ? 'expired' : left < 86_400_000 ? 'expiring' : 'valid';
  })();

  const step = currentStep(sheet);
  const open = sheet.stage === 'OPEN';
  const onRoad = sheet.stage === 'IN_TRANSIT';
  const done = !!sheet.deliveredAt;

  // The latest place the truck is known to be: a typed position with
  // coordinates, else the place typed, else where it loads.
  const latest = [...sheet.updates].reverse()[0] as TrackingUpdate | undefined;
  const withCoords = [...sheet.updates].reverse().find((u) => u.lat !== null && u.lng !== null);
  const mapQuery = withCoords
    ? `${withCoords.lat},${withCoords.lng}`
    : latest?.location ?? (done ? sheet.toCity : sheet.fromCity) ?? 'India';

  const columns: Column<TrackingUpdate>[] = [
    { key: 'when', label: 'When', render: (r) => fmtDateTime(r.recordedAt) },
    {
      key: 'what',
      label: 'What',
      render: (r) =>
        r.kind === 'UPDATE' ? (
          r.status && r.status !== 'MOVING' ? (
            <Tag tone={['BREAKDOWN', 'ACCIDENT'].includes(r.status) ? 'red' : 'flag'}>{TRACKING_STATUS_LABEL[r.status]}</Tag>
          ) : (
            KIND_LABEL.UPDATE + (r.status ? ` · ${TRACKING_STATUS_LABEL[r.status]}` : '')
          )
        ) : (
          <Tag tone={r.kind === 'UNLOADED' ? 'mint' : r.kind === 'EWAY_EXTENDED' ? 'flag' : 'blue'}>{KIND_LABEL[r.kind]}</Tag>
        ),
    },
    {
      key: 'where',
      label: 'Where',
      render: (r) =>
        r.lat !== null && r.lng !== null ? (
          <a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">
            {r.location}
          </a>
        ) : (
          r.location
        ),
    },
    { key: 'note', label: 'Note', render: (r) => r.note ?? <span className="muted">—</span> },
    { key: 'by', label: 'By', render: (r) => r.recordedByName ?? <span className="muted">—</span> },
  ];

  if (!sheet.vehicleNo) {
    return (
      <Banner tone="grey" title="Tracking starts once a vehicle is allocated">
        Award the load and allocate the truck from the Next step on the Details tab. The tracking sheet opens with “On
        the way to the loading point”.
      </Banner>
    );
  }

  return (
    <Stack>
      <Panel title={`🧭 Where the truck is · ${sheet.vehicleNo}`}>
        {/* The order cycle as a row of steps: done, current, still to come. */}
        <ol aria-label="Order cycle" className="cycle">
          {STEPS.map((s, i) => {
            const state = i < step || (i === step && done) ? 'done' : i === step ? 'now' : 'next';
            return (
              <li key={s.key} aria-current={state === 'now' ? 'step' : undefined} className={`cycle-step is-${state}`}>
                <span className="cycle-dot" aria-hidden>
                  {state === 'done' ? '✓' : s.emoji}
                </span>
                <span>{s.label}</span>
              </li>
            );
          })}
        </ol>

        {/* The one thing to do next, as a button. */}
        {canRun && open && !sheet.reachedLoadingAt && (
          <div className="cycle-action">
            <span className="muted" style={{ fontSize: 12.5 }}>
              The truck is on its way to {sheet.fromCity ?? 'the loading point'}.
            </span>
            <button className="btn" disabled={busy} onClick={() => mark('REACHED_LOADING', 'Marked · reached the loading point')}>
              📍 Reached the loading point
            </button>
          </div>
        )}
        {canRun && open && sheet.reachedLoadingAt && !sheet.loadedAt && (
          <div className="cycle-action">
            <span className="muted" style={{ fontSize: 12.5 }}>
              At the loading point since {fmtDateTime(sheet.reachedLoadingAt)}.
            </span>
            <button className="btn" disabled={busy} onClick={() => mark('LOADED', 'Marked loaded · upload the advance documents next')}>
              📦 Loaded
            </button>
          </div>
        )}
        {open && sheet.loadedAt && (
          <div className="cycle-action">
            <span className="muted" style={{ fontSize: 12.5 }}>
              Loaded {fmtDateTime(sheet.loadedAt)}. Upload the advance documents, then start the trip — once the advance is
              paid the truck moves to the road by itself.
            </span>
            <button className="btn btn-secondary" onClick={openDocuments}>
              📎 Upload advance documents
            </button>
            {canRun && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => run(() => departTrip(tripId), 'Trip started — the truck is on the road')}
              >
                🚚 Start trip
              </button>
            )}
          </div>
        )}
        {canRun && onRoad && (
          <div className="cycle-action">
            {!sheet.reachedDestinationAt && (
              <button className="btn" disabled={busy} onClick={() => mark('REACHED', 'Marked · reached the unloading point')}>
                🏁 Reached the unloading point
              </button>
            )}
            <label className="field" style={{ margin: 0 }}>
              <span className="muted" style={{ fontSize: 11.5 }}>
                Unloaded at
              </span>
              <input type="datetime-local" value={unloadedAt} onChange={(e) => setUnloadedAt(e.target.value)} />
            </label>
            <button
              className={sheet.reachedDestinationAt ? 'btn' : 'btn btn-secondary'}
              disabled={busy}
              onClick={() =>
                run(() => deliverTrip(tripId, new Date(unloadedAt).toISOString()), 'Marked unloaded — upload the proof of delivery next')
              }
            >
              ✅ Mark unloaded
            </button>
          </div>
        )}
        {done && (
          <div className="cycle-action">
            <span className="muted" style={{ fontSize: 12.5 }}>
              Unloaded {fmtDateTime(sheet.deliveredAt)}. The proof of delivery — E-POD or H-POD — is uploaded on the
              Documents tab.
            </span>
            <button className="btn" onClick={openDocuments}>
              📸 Upload proof of delivery
            </button>
          </div>
        )}
      </Panel>

      {/* The e-way bill rides with the truck. Tracking is mandatory partly for
          this: one that runs out before unloading has to be extended. */}
      {(open || onRoad) && (
        <Panel
          title="🧾 E-way bill"
          right={
            ewayState === 'expired' ? (
              <Tag tone="red">Expired</Tag>
            ) : ewayState === 'expiring' ? (
              <Tag tone="flag">Runs out within a day</Tag>
            ) : ewayState === 'valid' ? (
              <Tag tone="mint">Valid</Tag>
            ) : (
              <Tag tone="grey">Not uploaded</Tag>
            )
          }
        >
          {!sheet.eway?.uploaded ? (
            <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              The e-way bill is uploaded with the advance documents once the truck is loaded. Its validity shows here,
              and it can be extended while the truck is on the road.
            </p>
          ) : (
            <>
              <p style={{ marginTop: 0, fontSize: 'var(--text-sm)' }}>
                {sheet.eway.ewayNo ? `No. ${sheet.eway.ewayNo} · ` : ''}
                valid till <strong>{sheet.eway.validTill ? fmtDate(sheet.eway.validTill) : '—'}</strong>
                {ewayState === 'expired'
                  ? ' — expired while the truck is not yet unloaded. Extend it now.'
                  : ewayState === 'expiring'
                    ? ' — runs out within a day and the truck is not yet unloaded. Extend it.'
                    : ''}
              </p>
              {canRun && (
                <>
                  <FormGrid>
                    <Field label="Extend validity till" required>
                      <input type="date" value={eway.validTill} onChange={(e) => setEway({ ...eway, validTill: e.target.value })} />
                    </Field>
                    <Field label="Extension / new e-way bill number" hint="Optional — if the extension has its own number.">
                      <input value={eway.ewayNo} onChange={(e) => setEway({ ...eway, ewayNo: e.target.value })} />
                    </Field>
                    <Field label="Why it was extended" hint="Optional — e.g. breakdown near Nagpur.">
                      <input value={eway.reason} onChange={(e) => setEway({ ...eway, reason: e.target.value })} />
                    </Field>
                  </FormGrid>
                  <button
                    className={ewayState === 'expired' || ewayState === 'expiring' ? 'btn' : 'btn btn-secondary'}
                    style={{ marginTop: 'var(--space-3)' }}
                    disabled={busy || !eway.validTill}
                    onClick={() =>
                      run(
                        () =>
                          extendEway(tripId, {
                            validTill: eway.validTill,
                            ...(eway.ewayNo.trim() ? { ewayNo: eway.ewayNo.trim() } : {}),
                            ...(eway.reason.trim() ? { reason: eway.reason.trim() } : {}),
                          }).then((r) => {
                            setEway({ validTill: '', ewayNo: '', reason: '' });
                            return r;
                          }),
                        'E-way bill extended',
                      )
                    }
                  >
                    🧾 Extend e-way bill
                  </button>
                </>
              )}
            </>
          )}
        </Panel>
      )}

      <Panel title="🗺️ Map" pad={false}>
        <iframe
          title={`Map — ${mapQuery}`}
          src={mapSrc(mapQuery)}
          style={{ width: '100%', height: 320, border: 0, display: 'block' }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        <div className="muted" style={{ fontSize: 11.5, padding: '8px 14px' }}>
          Showing {withCoords ? `${withCoords.location} (${withCoords.lat}, ${withCoords.lng})` : mapQuery}.{' '}
          <a href={`https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noreferrer">
            Open in Google Maps ↗
          </a>
        </div>
      </Panel>

      {canRun && !done && (
        <Panel title="✍️ Add a tracking update">
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            Where the truck is now — from the driver’s call or the GPS screen. Coordinates are optional; with them the map
            shows the exact spot.
          </p>
          <FormGrid>
            <Field label="Status" hint="How the truck is doing right now.">
              <select value={update.status} onChange={(e) => setUpdate({ ...update, status: e.target.value as TrackingStatus })}>
                {(Object.keys(TRACKING_STATUS_LABEL) as TrackingStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {TRACKING_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Location" required hint="A city, toll plaza or landmark.">
              <input value={update.location} onChange={(e) => setUpdate({ ...update, location: e.target.value })} placeholder="e.g. Nagpur bypass" />
            </Field>
            <Field label="Latitude">
              <input type="number" step="any" value={update.lat} onChange={(e) => setUpdate({ ...update, lat: e.target.value })} />
            </Field>
            <Field label="Longitude">
              <input type="number" step="any" value={update.lng} onChange={(e) => setUpdate({ ...update, lng: e.target.value })} />
            </Field>
            <Field label="Note">
              <input value={update.note} onChange={(e) => setUpdate({ ...update, note: e.target.value })} placeholder="e.g. Driver says 6 hours to go" />
            </Field>
          </FormGrid>
          <button
            className="btn"
            style={{ marginTop: 12 }}
            disabled={busy || update.location.trim().length < 2 || !!update.lat.trim() !== !!update.lng.trim()}
            onClick={addUpdate}
          >
            Add update
          </button>
        </Panel>
      )}

      <Panel title="📋 Tracking sheet" pad={false}>
        <DataTable
          columns={columns}
          rows={[...sheet.updates].reverse()}
          rowKey={(r) => r.id}
          empty="Nothing on the sheet yet. It starts when the truck reaches the loading point."
        />
      </Panel>
    </Stack>
  );
}
