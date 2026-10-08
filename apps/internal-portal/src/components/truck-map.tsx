'use client';

import { PointerEvent as ReactPointerEvent, ReactNode, useEffect, useRef, useState } from 'react';

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
const HEIGHT = 460;
/** The information card laid over the right of a wide map: its width and the gap round it. */
const SIDE_W = 288;
const SIDE_GAP = 12;
/** Below this the card goes under the map instead of over it. */
const STACK_BELOW = 720;
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

/** The closest zoom at which every pin still fits inside a box, with room around the edge. */
function fitZoom(pins: Pin[], width: number, height: number): number {
  for (let zoom = 13; zoom > 3; zoom--) {
    const xs = pins.map((p) => worldX(p.lng, zoom));
    const ys = pins.map((p) => worldY(p.lat, zoom));
    if (Math.max(...xs) - Math.min(...xs) <= width - 130 && Math.max(...ys) - Math.min(...ys) <= height - 150) return zoom;
  }
  return 3;
}

/** Kilometres between two points as the crow flies. */
function kmBetween(a: Pin, b: Pin): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const km = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-IN')} km`;

/* ---- the three looks of the map ---------------------------------------------
   Light is OpenStreetMap's own map. Dark is CARTO's dark map, drawn from the
   same OpenStreetMap data. Satellite is Esri's world imagery. Each asks to be
   credited on the map, which the line at the bottom right does. */

export type MapStyle = 'light' | 'dark' | 'satellite';

const OSM_CREDIT = (
  <>
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors
  </>
);

const STYLES: Record<
  MapStyle,
  { label: string; tile: (z: number, x: number, y: number) => string; credit: ReactNode; ground: string }
> = {
  light: {
    label: 'Light',
    tile: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    credit: OSM_CREDIT,
    ground: '#e8ecef',
  },
  dark: {
    label: 'Dark',
    tile: (z, x, y) => `https://${'abcd'[(x + y) % 4]}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`,
    credit: (
      <>
        {OSM_CREDIT} ©{' '}
        <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">
          CARTO
        </a>
      </>
    ),
    ground: '#1b1f27',
  },
  satellite: {
    label: 'Satellite',
    tile: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    credit: <>Imagery © Esri, Maxar, Earthstar Geographics</>,
    ground: '#0d2233',
  },
};

const STYLE_KEY = 'nexraah-map-style';

const consoleTheme = (): MapStyle =>
  typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

/**
 * Which look the map has. Until somebody picks one it follows the console's
 * own light or dark mode, and changes with it; a pick is kept in this browser.
 */
function useMapStyle(): [MapStyle, (next: MapStyle) => void] {
  const [style, setStyle] = useState<MapStyle>('light');
  const picked = useRef(false);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STYLE_KEY);
    } catch {
      // Storage blocked: the map just follows the theme.
    }
    if (saved === 'light' || saved === 'dark' || saved === 'satellite') {
      picked.current = true;
      setStyle(saved);
    } else {
      setStyle(consoleTheme());
    }
    const watcher = new MutationObserver(() => {
      if (!picked.current) setStyle(consoleTheme());
    });
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => watcher.disconnect();
  }, []);

  const pick = (next: MapStyle) => {
    picked.current = true;
    setStyle(next);
    try {
      window.localStorage.setItem(STYLE_KEY, next);
    } catch {
      // Storage blocked: the pick holds until the page is reloaded.
    }
  };
  return [style, pick];
}

/** What the card beside the map says about the truck. The distances are added by the map itself. */
export interface MapSide {
  /** Small line above the heading — the client, or the trip. */
  eyebrow?: string;
  heading: string;
  /** "En route", "At the loading point" … */
  status: string;
  facts: [string, ReactNode][];
  /** The last thing the desk typed about the truck. */
  note?: string | null;
}

/**
 * The truck on a map: where it was last reported, the loading point (1) and
 * the unloading point (2), the part of the trip behind it as a solid line and
 * the part still to go as a dashed one.
 *
 * The map can be shown light, dark or as satellite imagery (the buttons at the
 * top left), zoomed, and dragged about. Beside it sits a card saying what the
 * truck is doing: its status, where and when it was last reported, the next
 * stop and how far that is.
 *
 * It is drawn here from map tiles rather than embedded from Google, because an
 * embedded Google map cannot be given a symbol or a card of our own. The lines
 * are straight, not the road — the road route is the Google map below it, and
 * the distances are straight-line and say so.
 *
 * Renders nothing until the truck's place is known, so a name that cannot be
 * found leaves the page as it was instead of showing a truck in the wrong town.
 */
export function TruckMap({
  truck,
  from,
  to,
  caption,
  side,
}: {
  truck: MapPlace | null;
  from: MapPlace | null;
  to: MapPlace | null;
  caption?: string;
  side?: MapSide;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pins, setPins] = useState<{ truck: Pin; from: Pin | null; to: Pin | null } | null>(null);
  const [nudge, setNudge] = useState(0);
  /** How far the map has been dragged from where it frames itself, in screen pixels. */
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const grip = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const [style, pickStyle] = useMapStyle();

  // Looked up again only when a place actually changes, not on every refresh of the sheet.
  const key = JSON.stringify([truck, from, to].map((p) => (p ? [p.lat ?? null, p.lng ?? null, p.query ?? null] : null)));
  useEffect(() => {
    let cancelled = false;
    setNudge(0);
    setDrag({ x: 0, y: 0 });
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

  // On a wide map the card lies over its right-hand side, so the trip is
  // framed in what is left; on a narrow one the card goes underneath.
  const over = !!side && (width || 800) >= STACK_BELOW;
  const clear = over ? SIDE_W + SIDE_GAP * 2 : 0;
  const view = Math.max(200, (width || 800) - clear);

  const all = [pins.from, pins.truck, pins.to].filter((p): p is Pin => !!p);
  const zoom = Math.max(3, Math.min(17, fitZoom(all, view, HEIGHT) + nudge));
  // Zoomed in by hand, the map follows the truck; otherwise it frames the whole trip.
  const centre = nudge > 0 ? [pins.truck] : all;
  const cx = (Math.min(...centre.map((p) => worldX(p.lng, zoom))) + Math.max(...centre.map((p) => worldX(p.lng, zoom)))) / 2;
  const cy = (Math.min(...centre.map((p) => worldY(p.lat, zoom))) + Math.max(...centre.map((p) => worldY(p.lat, zoom)))) / 2;
  const left = cx - view / 2 - drag.x;
  const top = cy - HEIGHT / 2 - drag.y;
  const at = (p: Pin) => ({ x: worldX(p.lng, zoom) - left, y: worldY(p.lat, zoom) - top });

  const tiles: { x: number; y: number }[] = [];
  const edge = 2 ** zoom;
  for (let x = Math.floor(left / TILE); x <= Math.floor((left + width) / TILE); x++) {
    for (let y = Math.floor(top / TILE); y <= Math.floor((top + HEIGHT) / TILE); y++) {
      if (y >= 0 && y < edge) tiles.push({ x, y });
    }
  }

  const zoomBy = (step: number) => {
    setNudge((n) => Math.max(-4, Math.min(8, n + step)));
    setDrag({ x: 0, y: 0 });
  };

  // Dragging moves the map; letting go leaves it there.
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, .truck-map-side')) return;
    grip.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: drag.x, oy: drag.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = grip.current;
    if (!g || g.id !== e.pointerId) return;
    setDrag({ x: g.ox + (e.clientX - g.x), y: g.oy + (e.clientY - g.y) });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (grip.current?.id === e.pointerId) grip.current = null;
  };

  const stop = (p: Pin, n: number, label: string) => {
    const { x, y } = at(p);
    return (
      <div key={label} role="img" aria-label={label} title={label} className="truck-map-stop" style={{ left: x, top: y }}>
        {n}
      </div>
    );
  };
  const truckAt = at(pins.truck);
  const line = (list: (Pin | null)[]) =>
    list
      .filter((p): p is Pin => !!p)
      .map((p) => `${at(p).x},${at(p).y}`)
      .join(' ');

  const covered = pins.from ? kmBetween(pins.from, pins.truck) : null;
  const toGo = pins.to ? kmBetween(pins.truck, pins.to) : null;
  const sideFacts: [string, ReactNode][] = side
    ? [
        ...side.facts,
        ...(toGo !== null ? ([['To the unloading point', `${km(toGo)} · straight line`]] as [string, ReactNode][]) : []),
        ...(covered !== null ? ([['From the loading point', `${km(covered)} · straight line`]] as [string, ReactNode][]) : []),
      ]
    : [];

  const card = side && (
    <aside className={over ? 'truck-map-side is-over' : 'truck-map-side'} aria-label="About this truck">
      {side.eyebrow && <div className="eyebrow">{side.eyebrow}</div>}
      <div className="truck-map-side-head">{side.heading}</div>
      <div className="truck-map-side-status">{side.status}</div>
      <dl className="truck-map-side-facts">
        {sideFacts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {side.note && <div className="truck-map-side-note">“{side.note}”</div>}
    </aside>
  );

  return (
    <div className="truck-map">
      <div
        ref={frame}
        data-testid="truck-map"
        className="truck-map-frame"
        style={{ height: HEIGHT, background: STYLES[style].ground }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {width > 0 &&
          tiles.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${style}/${zoom}/${t.x}/${t.y}`}
              alt=""
              draggable={false}
              src={STYLES[style].tile(zoom, ((t.x % edge) + edge) % edge, t.y)}
              width={TILE}
              height={TILE}
              style={{ position: 'absolute', left: t.x * TILE - left, top: t.y * TILE - top, maxWidth: 'none' }}
            />
          ))}

        {width > 0 && (
          <>
            <svg width={width} height={HEIGHT} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
              {/* Still to go: a dashed line from the truck to the unloading point. */}
              <polyline
                points={line([pins.truck, pins.to])}
                fill="none"
                stroke={style === 'light' ? '#3b4a6b' : '#dfe7f5'}
                strokeWidth={3}
                strokeDasharray="7 7"
                strokeLinecap="round"
                opacity={0.85}
              />
              {/* Behind it: a solid line from the loading point to the truck, on a pale edge so it reads on any map. */}
              <polyline points={line([pins.from, pins.truck])} fill="none" stroke="#ffffff" strokeWidth={7} strokeLinecap="round" opacity={0.7} />
              <polyline points={line([pins.from, pins.truck])} fill="none" stroke="#f26b21" strokeWidth={4} strokeLinecap="round" />
            </svg>
            {pins.from && stop(pins.from, 1, `Loading point — ${from?.label ?? ''}`)}
            {pins.to && stop(pins.to, 2, `Unloading point — ${to?.label ?? ''}`)}
            <div
              role="img"
              aria-label={`Truck — ${truck?.label ?? ''}`}
              title={`Truck — ${truck?.label ?? ''}`}
              className="truck-map-truck"
              style={{ left: truckAt.x, top: truckAt.y }}
            >
              <span aria-hidden>🚚</span>
            </div>
            {truck?.label && (
              <div className="truck-map-label" style={{ left: truckAt.x, top: truckAt.y - 34 }}>
                {truck.label}
              </div>
            )}
          </>
        )}

        <div className="truck-map-styles" role="group" aria-label="Map style">
          {(Object.keys(STYLES) as MapStyle[]).map((s) => (
            <button key={s} type="button" className={s === style ? 'is-on' : undefined} aria-pressed={s === style} onClick={() => pickStyle(s)}>
              {STYLES[s].label}
            </button>
          ))}
        </div>
        <div className="truck-map-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)}>
            ＋
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)}>
            －
          </button>
        </div>

        <div className="truck-map-legend">
          <span>
            <i className="is-done" /> Covered so far
          </span>
          <span>
            <i className="is-todo" /> Still to go
          </span>
          <span className="truck-map-legend-note">straight lines, not the road</span>
        </div>
        <div className="truck-map-credit">{STYLES[style].credit}</div>

        {over && card}
      </div>
      {!over && card}
      {caption && (
        <div className="muted" style={{ fontSize: 11.5, padding: '8px 14px' }}>
          {caption}
        </div>
      )}
    </div>
  );
}
