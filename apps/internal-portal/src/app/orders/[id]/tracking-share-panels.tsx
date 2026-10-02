'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { RoutePoints, ShareState, createShare, saveRoutePoints, stopShare } from '@/app/trips/tracking-share';
import { RoutePoint, coordsFrom, placeLink, placeQuery, smsLink, whatsappLink } from '@/lib/route-map';
import { Banner, Field, FormGrid, Panel, Tag, useToast } from '@/lib/ui';

/** A phone number box with the two ways to send: WhatsApp, or a normal text message. */
function SendRow({ message, label }: { message: string; label: string }) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast('Copied — paste it anywhere');
    } catch {
      toast('Could not copy. Select the text and copy it by hand.');
    }
  };
  return (
    <div className="share-row">
      <label className="field" style={{ margin: 0, flex: '1 1 180px' }}>
        <span className="muted" style={{ fontSize: 11.5 }}>
          Mobile number — optional
        </span>
        <input
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. 98480 12345"
          aria-label={`Mobile number to send the ${label} to`}
        />
      </label>
      <a className="btn btn-sm share-wa" href={whatsappLink(message, phone)} target="_blank" rel="noreferrer">
        💬 WhatsApp
      </a>
      <a className="btn btn-secondary btn-sm" href={smsLink(message, phone)}>
        ✉️ SMS
      </a>
      <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
        📋 Copy
      </button>
    </div>
  );
}

interface PointDraft {
  address: string;
  /** A pasted Google Maps link, or `lat, lng`. */
  pin: string;
}

const draftOf = (p: RoutePoint): PointDraft => ({
  address: p.address ?? '',
  pin: p.lat !== null && p.lng !== null ? `${p.lat}, ${p.lng}` : '',
});

/**
 * The exact loading and unloading points of this route.
 *
 * Kept per client and route, so they are captured once: the next vehicle
 * placed for the same client on the same route opens with them filled in.
 * Either one can be sent to a phone — the driver's, usually — as a Google
 * Maps link by WhatsApp or SMS.
 */
export function RoutePointsPanel({
  tripId,
  vehicleNo,
  points,
  canEdit,
  onSaved,
}: {
  tripId: string;
  vehicleNo: string | null;
  points: RoutePoints;
  canEdit: boolean;
  onSaved: (next: RoutePoints) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState<PointDraft>(() => draftOf(points.loading));
  const [unloading, setUnloading] = useState<PointDraft>(() => draftOf(points.unloading));
  useEffect(() => {
    setLoading(draftOf(points.loading));
    setUnloading(draftOf(points.unloading));
  }, [points]);

  const pinProblem = (d: PointDraft) => (d.pin.trim() && !coordsFrom(d.pin) ? 'No coordinates in this. Paste the full Google Maps link, or type "17.6868, 83.2185".' : undefined);
  const body = (d: PointDraft) => {
    const c = d.pin.trim() ? coordsFrom(d.pin) : null;
    return { address: d.address.trim() || undefined, ...(c ? { lat: c.lat, lng: c.lng } : {}) };
  };
  const dirty = (d: PointDraft, saved: RoutePoint) => JSON.stringify(d) !== JSON.stringify(draftOf(saved));

  const save = async () => {
    setBusy(true);
    try {
      const next = await saveRoutePoints(tripId, { loading: body(loading), unloading: body(unloading) });
      toast('Saved · kept for every later trip of this client on this route');
      onSaved(next);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const block = (
    which: 'Loading' | 'Unloading',
    city: string,
    saved: RoutePoint,
    draft: PointDraft,
    setDraft: (d: PointDraft) => void,
  ) => {
    const has = !!saved.address || saved.lat !== null;
    const link = placeLink(placeQuery(saved, city));
    const message =
      `${which} point${vehicleNo ? ` for truck ${vehicleNo}` : ''} — ${city}` +
      `${saved.address ? `\n${saved.address}` : ''}\nMap: ${link}`;
    return (
      <div className="route-point">
        <div className="route-point-head">
          <strong>
            {which === 'Loading' ? '📦' : '🏁'} {which} point · {city}
          </strong>
          {saved.lat !== null ? <Tag tone="mint">Pinned on the map</Tag> : has ? <Tag tone="blue">Address only</Tag> : <Tag tone="grey">Not captured</Tag>}
        </div>
        {canEdit ? (
          <FormGrid>
            <Field label="Address" hint="Plant, godown or gate — what the driver should look for.">
              <input
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder={which === 'Loading' ? 'e.g. Gate 2, Siriman Chemicals, JN Pharma City' : 'e.g. Sri Venkateswara Godown, NH-16'}
              />
            </Field>
            <Field label="Map pin" hint="Paste a Google Maps link, or type latitude, longitude." error={pinProblem(draft)}>
              <input value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value })} placeholder="17.6868, 83.2185" />
            </Field>
          </FormGrid>
        ) : (
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>{saved.address ?? <span className="muted">No address captured yet.</span>}</p>
        )}
        {has && (
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Send this location —{' '}
              <a href={link} target="_blank" rel="noreferrer">
                open it in Google Maps ↗
              </a>
            </div>
            <SendRow message={message} label={`${which.toLowerCase()} location`} />
          </div>
        )}
      </div>
    );
  };

  const changed = dirty(loading, points.loading) || dirty(unloading, points.unloading);
  return (
    <Panel
      title="📍 Loading and unloading points"
      right={points.onFile ? <Tag tone="mint">On file for this client and route</Tag> : <Tag tone="flag">Not captured yet</Tag>}
    >
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        The exact places, not just the cities. Captured once: every later vehicle placed for this client on{' '}
        {points.fromCity} → {points.toCity} opens with them already filled in.
      </p>
      {block('Loading', points.fromCity, points.loading, loading, setLoading)}
      {block('Unloading', points.toCity, points.unloading, unloading, setUnloading)}
      {canEdit && (
        <button
          className="btn"
          style={{ marginTop: 12 }}
          disabled={busy || !changed || !!pinProblem(loading) || !!pinProblem(unloading)}
          onClick={save}
        >
          Save the points
        </button>
      )}
    </Panel>
  );
}

/**
 * The shareable live-tracking link.
 *
 * One link per trip, sent to the client or to the truck's owner by WhatsApp or
 * SMS. It opens a page that shows the route and where the truck is — nothing
 * about who the client or the transporter is, and no rates — so the same link
 * is safe for either side. It works until the truck is unloaded.
 */
export function ShareTrackingPanel({
  tripId,
  vehicleNo,
  fromCity,
  toCity,
  share,
  canShare,
  onChanged,
}: {
  tripId: string;
  vehicleNo: string | null;
  fromCity: string | null;
  toCity: string | null;
  share: ShareState;
  canShare: boolean;
  onChanged: (next: ShareState) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<ShareState>, done: string) => {
    setBusy(true);
    try {
      onChanged(await action());
      toast(done);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const url = share.token && typeof window !== 'undefined' ? `${window.location.origin}/track/${share.token}` : '';
  const message =
    `Track your shipment${fromCity && toCity ? ` ${fromCity} → ${toCity}` : ''}` +
    `${vehicleNo ? `, truck ${vehicleNo}` : ''}:\n${url}\nThe link works until the truck is unloaded. — Nexraah`;

  return (
    <Panel
      title="🔗 Share live tracking"
      right={
        share.active ? (
          <Tag tone="mint">Link is live</Tag>
        ) : share.endedBecause === 'UNLOADED' ? (
          <Tag tone="grey">Ended — unloaded</Tag>
        ) : (
          <Tag tone="grey">Not shared</Tag>
        )
      }
    >
      {share.active ? (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            Anyone with this link sees the route and where the truck is — no sign-in, and nothing about the client, the
            transporter or the rates. Send it to the client, the truck’s owner, or both. It stops working when the truck
            is unloaded.
          </p>
          <input readOnly value={url} aria-label="Tracking link" onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
          <div style={{ marginTop: 10 }}>
            <SendRow message={message} label="tracking link" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noreferrer">
              Preview what they see ↗
            </a>
            {canShare && (
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => run(() => stopShare(tripId), 'Sharing stopped · the link no longer works')}
              >
                Stop sharing
              </button>
            )}
          </div>
        </>
      ) : share.endedBecause === 'UNLOADED' ? (
        <Banner tone="grey" title="The tracking link has ended">
          The truck is unloaded, so the link that was shared no longer shows anything.
        </Banner>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            Create a link the client or the truck’s owner can open on their phone to follow this truck until it is
            unloaded. You send it by WhatsApp or SMS.
          </p>
          {canShare ? (
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(() => createShare(tripId), 'Tracking link ready · send it by WhatsApp or SMS')}
            >
              🔗 Create tracking link
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Operations creates the tracking link.
            </span>
          )}
        </>
      )}
    </Panel>
  );
}
