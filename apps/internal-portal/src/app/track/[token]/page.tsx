'use client';

/**
 * The shared live-tracking page — `/track/<token>`.
 *
 * Opened from a WhatsApp or SMS message by a client or by the truck's owner,
 * on a phone, with no sign-in: the unguessable token in the address is what
 * lets them in. It shows one truck's route and where it is, and nothing else —
 * no client name, no transporter name, no rates — so the same link is safe to
 * send to either side.
 *
 * It refreshes itself while it is open, and stops showing anything once the
 * truck is unloaded or the desk switches the link off.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError } from '@/apis';
import { PublicTracking, getPublicTracking } from '@/app/trips/tracking-share';
import { TRACKING_STATUS_LABEL } from '@/app/trips/types';
import { fmtDateTime } from '@/lib/format';
import { placeQuery, placeText, routeMapLink, routeMapSrc } from '@/lib/route-map';

const REFRESH_MS = 60_000;

const STEPS = ['On the way to loading', 'At the loading point', 'Loaded', 'On the road', 'At the unloading point'];

function stepOf(t: PublicTracking): number {
  if (t.reachedDestinationAt) return 4;
  if (t.departedAt || t.stage === 'IN_TRANSIT') return 3;
  if (t.loadedAt) return 2;
  if (t.reachedLoadingAt) return 1;
  return 0;
}

const KIND_TEXT: Record<string, string> = {
  REACHED_LOADING: 'Reached the loading point',
  LOADED: 'Loaded',
  DEPARTED: 'Left for delivery',
  REACHED: 'Reached the unloading point',
  UNLOADED: 'Unloaded',
  EWAY_EXTENDED: 'E-way bill extended',
};

export default function PublicTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicTracking | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  // A link nobody ever made is not one that ended — it gets its own heading.
  const [unknown, setUnknown] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () =>
      getPublicTracking(token)
        .then((d) => {
          if (stop) return;
          setData(d);
          setFailed(false);
        })
        .catch((e) => {
          if (stop) return;
          // 404 and 410 are final — the link is wrong, switched off, or the truck is unloaded.
          if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
            setEnded(e.message);
            setUnknown(e.status === 404);
            setData(null);
          } else {
            setFailed(true);
          }
        });
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [token]);

  return (
    <div className="track-page">
      <header className="track-head">
        <img src="/logo.png" alt="Nexraah" className="track-logo" />
        <div>
          <div className="track-brand">Nexraah</div>
          <div className="track-sub">Live shipment tracking</div>
        </div>
      </header>

      {ended && (
        <div className="track-card track-ended">
          <div className="track-ended-emoji" aria-hidden>
            {unknown ? '🔗' : '🏁'}
          </div>
          <h1>{unknown ? 'Tracking link not found' : 'Tracking has ended'}</h1>
          <p>{unknown ? 'Check that the whole link was copied, or ask Nexraah to send it again.' : ended}</p>
        </div>
      )}

      {!ended && !data && (
        <div className="track-card">
          <p className="track-muted" style={{ margin: 0 }}>
            {failed ? 'Could not load the tracking just now. It will try again in a minute.' : 'Loading the tracking…'}
          </p>
        </div>
      )}

      {data && <Tracking t={data} />}

      <footer className="track-foot">This page updates by itself every minute, until the truck is unloaded.</footer>
    </div>
  );
}

function Tracking({ t }: { t: PublicTracking }) {
  const step = stepOf(t);
  const origin = placeQuery(t.loading, t.fromCity);
  const destination = placeQuery(t.unloading, t.toCity);
  const positions = t.updates.filter((u) => u.kind === 'UPDATE');
  const last = positions[positions.length - 1];
  const onRoad = step >= 3;
  const via = onRoad && last ? (last.lat !== null && last.lng !== null ? `${last.lat},${last.lng}` : placeText(last.location)) : null;
  const history = [...t.updates].reverse();

  return (
    <>
      <div className="track-card">
        <div className="track-route">
          <span>{t.fromCity ?? 'Loading point'}</span>
          <span aria-hidden className="track-arrow">
            →
          </span>
          <span>{t.toCity ?? 'Unloading point'}</span>
        </div>
        {t.vehicleNo && <div className="track-truck">🚛 {t.vehicleNo}</div>}

        <ol className="track-steps" aria-label="Where the truck is">
          {STEPS.map((label, i) => (
            <li key={label} className={i < step ? 'is-done' : i === step ? 'is-now' : 'is-next'} aria-current={i === step ? 'step' : undefined}>
              <span className="track-dot" aria-hidden>
                {i < step ? '✓' : i + 1}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>

        {last ? (
          <div className="track-last">
            <div className="track-muted">Last reported</div>
            <strong>{last.location}</strong>
            <div className="track-muted">
              {fmtDateTime(last.recordedAt)}
              {last.status && last.status !== 'MOVING' ? ` · ${TRACKING_STATUS_LABEL[last.status]}` : ''}
            </div>
          </div>
        ) : (
          <div className="track-last">
            <div className="track-muted">No position reported yet. It will show here as the truck moves.</div>
          </div>
        )}
      </div>

      <div className="track-card track-map">
        <iframe
          title={`Route — ${t.fromCity ?? 'loading point'} to ${t.toCity ?? 'unloading point'}`}
          src={routeMapSrc(origin, destination, via)}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        <a className="track-maplink" href={routeMapLink(origin, destination, via)} target="_blank" rel="noreferrer">
          Open the route in Google Maps ↗
        </a>
      </div>

      {(t.loading.address || t.unloading.address) && (
        <div className="track-card">
          {t.loading.address && (
            <p className="track-point">
              <span className="track-muted">📦 Loading point</span>
              {t.loading.address}
            </p>
          )}
          {t.unloading.address && (
            <p className="track-point">
              <span className="track-muted">🏁 Unloading point</span>
              {t.unloading.address}
            </p>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="track-card">
          <h2>Updates</h2>
          <ul className="track-history">
            {history.map((u) => (
              <li key={u.id}>
                <span className="track-muted">{fmtDateTime(u.recordedAt)}</span>
                <span>
                  {u.kind === 'UPDATE'
                    ? `${u.location}${u.status && u.status !== 'MOVING' ? ` — ${TRACKING_STATUS_LABEL[u.status]}` : ''}`
                    : `${KIND_TEXT[u.kind] ?? u.kind}${u.location ? ` · ${u.location}` : ''}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
