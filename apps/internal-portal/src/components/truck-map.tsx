'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A place to put on the map: its coordinates when they are known, else the
 * name somebody typed ("Tirupathi"), which is looked up.
 */
export interface MapPlace {
  label: string;
  lat?: number | null;
  lng?: number | null;
  /** What to look up when there are no coordinates. */
  query?: string | null;
}

interface Pin {
  lat: number;
  lng: number;
}

const TILE = 256;
const HEIGHT = 360;
const CACHE_KEY = 'nexraah.geocode.v1';

/* ---- looking a typed place up ---------------------------------------------
   Most tracking updates are a place name from the driver's phone call, with no
   coordinates. OpenStreetMap's search turns the name into a point. Answers are
   kept in the browser, so one place is asked for once, not on every refresh. */

function cached(): Record<string, Pin | null> {
  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

async function lookUp(query: string): Promise<Pin | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  const known = cached();
  if (key in known) return known[key];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) return null;
    const hit = (await res.json())[0];
    const pin = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cached(), [key]: pin }));
    } catch {
      // Storage full or blocked: it is simply asked for again next time.
    }
    return pin;
  } catch {
    // Offline, or the lookup is unreachable: the caller shows no map rather than a wrong one.
    return null;
  }
}

async function resolve(place: MapPlace | null): Promise<Pin | null> {
  if (!place) return null;
  if (typeof place.lat === 'number' && typeof place.lng === 'number') return { lat: place.lat, lng: place.lng };
  return place.query ? lookUp(place.query) : null;
}

/* ---- the map's arithmetic --------------------------------------------------
   Web Mercator, the projection every tiled map uses: the world is a square of
   256 × 2^zoom pixels. */

const worldX = (lng: number, zoom: number) => ((lng + 180) / 360) * TILE * 2 ** zoom;
const worldY = (lat: number, zoom: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** zoom;
};

/** The closest zoom at which every pin still fits inside the frame, with room around the edge. */
function fitZoom(pins: Pin[], width: number): number {
  for (let zoom = 12; zoom > 3; zoom--) {
    const xs = pins.map((p) => worldX(p.lng, zoom));
    const ys = pins.map((p) => worldY(p.lat, zoom));
    if (Math.max(...xs) - Math.min(...xs) <= width - 120 && Math.max(...ys) - Math.min(...ys) <= HEIGHT - 120) return zoom;
  }
  return 3;
}

/**
 * The truck on a map: a truck symbol where it was last reported, the loading
 * point and the unloading point, and a line joining them in order.
 *
 * Drawn here from OpenStreetMap tiles rather than embedded from Google,
 * because an embedded Google map can show a route and a plain pin but cannot
 * be given a symbol of our own. The line is straight, not the road — the road
 * route is the Google map beside it.
 *
 * Renders nothing until the truck's place is known, so a name that cannot be
 * found leaves the page as it was instead of showing a truck in the wrong town.
 */
export function TruckMap({
  truck,
  from,
  to,
  caption,
}: {
  truck: MapPlace | null;
  from: MapPlace | null;
  to: MapPlace | null;
  caption?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pins, setPins] = useState<{ truck: Pin; from: Pin | null; to: Pin | null } | null>(null);
  const [nudge, setNudge] = useState(0);

  // Looked up again only when a place actually changes, not on every refresh of the sheet.
  const key = JSON.stringify([truck, from, to].map((p) => (p ? [p.lat ?? null, p.lng ?? null, p.query ?? null] : null)));
  useEffect(() => {
    let cancelled = false;
    setNudge(0);
    Promise.all([resolve(truck), resolve(from), resolve(to)]).then(([t, f, d]) => {
      if (!cancelled) setPins(t ? { truck: t, from: f, to: d } : null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const measure = () => setWidth(frame.current?.clientWidth ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [pins]);

  if (!pins) return null;

  const all = [pins.from, pins.truck, pins.to].filter((p): p is Pin => !!p);
  const zoom = Math.max(3, Math.min(16, fitZoom(all, width || 800) + nudge));
  // Zoomed in by hand, the map follows the truck; otherwise it frames the whole trip.
  const centre = nudge > 0 ? [pins.truck] : all;
  const cx = (Math.min(...centre.map((p) => worldX(p.lng, zoom))) + Math.max(...centre.map((p) => worldX(p.lng, zoom)))) / 2;
  const cy = (Math.min(...centre.map((p) => worldY(p.lat, zoom))) + Math.max(...centre.map((p) => worldY(p.lat, zoom)))) / 2;
  const left = cx - width / 2;
  const top = cy - HEIGHT / 2;
  const at = (p: Pin) => ({ x: worldX(p.lng, zoom) - left, y: worldY(p.lat, zoom) - top });

  const tiles: { x: number; y: number }[] = [];
  const edge = 2 ** zoom;
  for (let x = Math.floor(left / TILE); x <= Math.floor((left + width) / TILE); x++) {
    for (let y = Math.floor(top / TILE); y <= Math.floor((top + HEIGHT) / TILE); y++) {
      if (y >= 0 && y < edge) tiles.push({ x, y });
    }
  }

  const marker = (p: Pin, symbol: string, label: string, size: number) => {
    const { x, y } = at(p);
    return (
      <div
        key={label}
        role="img"
        aria-label={label}
        title={label}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          transform: 'translate(-50%, -50%)',
          width: size,
          height: size,
          display: 'grid',
          placeItems: 'center',
          fontSize: size * 0.58,
          lineHeight: 1,
          background: '#fff',
          border: '2px solid var(--color-accent-400, #2f5fd0)',
          borderRadius: '50%',
          boxShadow: '0 2px 6px rgba(0,0,0,.35)',
        }}
      >
        <span aria-hidden>{symbol}</span>
      </div>
    );
  };

  return (
    <div>
      <div
        ref={frame}
        data-testid="truck-map"
        style={{ position: 'relative', height: HEIGHT, overflow: 'hidden', background: '#e8ecef' }}
      >
        {width > 0 &&
          tiles.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${zoom}/${t.x}/${t.y}`}
              alt=""
              src={`https://tile.openstreetmap.org/${zoom}/${((t.x % edge) + edge) % edge}/${t.y}.png`}
              width={TILE}
              height={TILE}
              style={{ position: 'absolute', left: t.x * TILE - left, top: t.y * TILE - top, maxWidth: 'none' }}
            />
          ))}

        {width > 0 && (
          <>
            <svg width={width} height={HEIGHT} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
              <polyline
                points={all.map((p) => `${at(p).x},${at(p).y}`).join(' ')}
                fill="none"
                stroke="#2f5fd0"
                strokeWidth={3}
                strokeDasharray="8 6"
                strokeLinecap="round"
              />
            </svg>
            {pins.from && marker(pins.from, '📍', `Loading point — ${from?.label ?? ''}`, 30)}
            {pins.to && marker(pins.to, '🏁', `Unloading point — ${to?.label ?? ''}`, 30)}
            {marker(pins.truck, '🚚', `Truck — ${truck?.label ?? ''}`, 44)}
          </>
        )}

        <div style={{ position: 'absolute', right: 10, top: 10, display: 'grid', gap: 4 }}>
          <button className="btn btn-secondary btn-sm" aria-label="Zoom in" onClick={() => setNudge((n) => Math.min(n + 1, 8))}>
            ＋
          </button>
          <button className="btn btn-secondary btn-sm" aria-label="Zoom out" onClick={() => setNudge((n) => Math.max(n - 1, -4))}>
            －
          </button>
        </div>
        <div
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            fontSize: 10,
            padding: '1px 5px',
            background: 'rgba(255,255,255,.8)',
            color: '#333',
          }}
        >
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors
        </div>
      </div>
      {caption && (
        <div className="muted" style={{ fontSize: 11.5, padding: '8px 14px' }}>
          {caption}
        </div>
      )}
    </div>
  );
}
