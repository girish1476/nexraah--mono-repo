import { createHmac, timingSafeEqual } from 'node:crypto';
import { command } from './people-store';

/**
 * Live truck positions, as GPS units and tracking apps report them.
 *
 * The same webhook the backend defines (docs/api/10-telematics-import.md,
 * `POST /telematics/ping`), run by this console's own server so it works on
 * the hosted site. Two ways in, so both a fitted GPS unit and a driver's phone
 * can report:
 *
 *   - JSON `{ vehicleNo, at, lat, lng, speedKmph?, fuelPct? }`, signed with
 *     HMAC-SHA256 over the raw body in `X-Telematics-Signature` (the backend's
 *     scheme), or carrying the device key as `Authorization: Bearer <key>`;
 *   - the OsmAnd protocol that Traccar Client and most tracking apps speak:
 *     `?id=<truck number>&lat=&lon=&timestamp=&speed=` (speed in knots), with
 *     `key=<device key>` in the same address.
 *
 * The latest position per truck is kept in the shared database — one hash,
 * one entry per truck, never a history — so the cost per report is two
 * database calls.
 */

const KEY = 'nexraah:gps';
/** A signed report is refused when its time is further than this from the server's — the backend's limit. */
const SIGNED_SKEW_MS = 5 * 60_000;
/** A phone that was out of signal sends its stored reports late; older than this is dropped. */
const OLDEST_MS = 3 * 86_400_000;
/** Ahead of the server clock by more than this, a report's time is wrong. */
const AHEAD_MS = 5 * 60_000;

export interface GpsPosition {
  vehicleNo: string;
  lat: number;
  lng: number;
  /** When the device took the reading (ISO). */
  at: string;
  speedKmph: number | null;
  fuelPct: number | null;
  receivedAt: string;
}

export class PingRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** One truck number however it is written: "MH 12 QR 8841", "mh12qr8841" and "MH-12-QR-8841" are the same truck. */
export const truckKey = (vehicleNo: string) => vehicleNo.toUpperCase().replace(/[^A-Z0-9]/g, '');

function sameSecret(offered: string, secret: string): boolean {
  const a = Buffer.from(offered);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameHex(offered: string, expected: string): boolean {
  const a = Buffer.from(offered.trim().toLowerCase(), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A time as ISO: an ISO string, or Unix seconds or milliseconds. */
function timeOf(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

export interface PingRequest {
  /** The exact body bytes, as text — what a signature covers. */
  raw: string;
  contentType: string;
  query: Record<string, string>;
  signature: string | null;
  bearer: string | null;
}

/**
 * Checks a report and reads the position out of it. Refuses anything not
 * carrying the device key (or signed with it), and anything that is not a
 * real position.
 */
export function readPing(req: PingRequest, deviceKey: string, now = Date.now()): GpsPosition {
  let body: Record<string, unknown> = {};
  const text = req.raw.trim();
  if (text) {
    if (req.contentType.includes('json') || text.startsWith('{')) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new PingRefused(400, 'The body is not valid JSON.');
      }
    } else {
      body = Object.fromEntries(new URLSearchParams(text));
    }
  }
  const field = (...names: string[]) => {
    for (const n of names) {
      if (body[n] !== undefined && body[n] !== '') return body[n];
      if (req.query[n] !== undefined && req.query[n] !== '') return req.query[n];
    }
    return undefined;
  };

  const signed = !!req.signature;
  if (signed) {
    const expected = createHmac('sha256', deviceKey).update(req.raw).digest('hex');
    if (!sameHex(req.signature as string, expected)) throw new PingRefused(401, 'The signature does not match.');
  } else {
    const offered = req.bearer ?? req.query.key ?? (typeof body.key === 'string' ? body.key : null);
    if (!offered) throw new PingRefused(401, 'Send the device key: "key" in the address, or an Authorization: Bearer header.');
    if (!sameSecret(offered, deviceKey)) throw new PingRefused(401, 'The device key is wrong.');
  }

  const vehicleNo = String(field('vehicleNo', 'vehicle_no', 'id', 'deviceid') ?? '')
    .trim()
    .toUpperCase();
  if (truckKey(vehicleNo).length < 4 || vehicleNo.length > 20) {
    throw new PingRefused(400, 'Say which truck: "vehicleNo" (or "id") is the truck number.');
  }

  const lat = num(field('lat', 'latitude'));
  const lng = num(field('lng', 'lon', 'longitude'));
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    throw new PingRefused(400, 'A position needs a latitude and a longitude.');
  }

  const stamped = timeOf(field('at', 'timestamp', 'time'));
  if (signed && (stamped === null || Math.abs(now - stamped) > SIGNED_SKEW_MS)) {
    throw new PingRefused(401, 'The report’s time is missing or more than 5 minutes from the server’s.');
  }
  const at = stamped ?? now;
  if (at > now + AHEAD_MS) throw new PingRefused(400, 'The report’s time is in the future — check the device clock.');
  if (at < now - OLDEST_MS) throw new PingRefused(400, 'The report is more than 3 days old.');

  // speedKmph as sent; OsmAnd's `speed` is in knots.
  const kmph = num(field('speedKmph'));
  const knots = kmph === null ? num(field('speed')) : null;
  const speed = kmph ?? (knots === null ? null : knots * 1.852);
  const fuel = num(field('fuelPct', 'fuel'));

  return {
    vehicleNo,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    at: new Date(at).toISOString(),
    speedKmph: speed === null ? null : Math.max(0, Math.min(300, Math.round(speed))),
    fuelPct: fuel === null ? null : Math.max(0, Math.min(100, Math.round(fuel))),
    receivedAt: new Date(now).toISOString(),
  };
}

function parse(raw: string | null | undefined): GpsPosition | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GpsPosition;
  } catch {
    return null;
  }
}

/** Keeps a report unless a newer one for the same truck is already kept (a phone sends stored reports late). */
export async function keepPosition(p: GpsPosition): Promise<'kept' | 'older'> {
  const key = truckKey(p.vehicleNo);
  const current = parse(await command<string | null>(['HGET', KEY, key]));
  if (current && current.at > p.at) return 'older';
  await command<number>(['HSET', KEY, key, JSON.stringify(p)]);
  return 'kept';
}

/** The latest position of each truck asked for, keyed by the truck number as it was asked. */
export async function positionsOf(vehicleNos: string[]): Promise<Record<string, GpsPosition>> {
  const asked = vehicleNos.filter((v) => truckKey(v).length >= 4);
  if (!asked.length) return {};
  const found = (await command<(string | null)[]>(['HMGET', KEY, ...asked.map(truckKey)])) ?? [];
  const out: Record<string, GpsPosition> = {};
  asked.forEach((v, i) => {
    const p = parse(found[i]);
    if (p) out[v] = p;
  });
  return out;
}

/** How many trucks have reported, and the latest report — for the Integrations screen's test. */
export async function gpsSummary(): Promise<{ count: number; latest: GpsPosition | null }> {
  const flat = (await command<string[] | null>(['HGETALL', KEY])) ?? [];
  let latest: GpsPosition | null = null;
  let count = 0;
  for (let i = 1; i < flat.length; i += 2) {
    const p = parse(flat[i]);
    if (!p) continue;
    count += 1;
    if (!latest || p.at > latest.at) latest = p;
  }
  return { count, latest };
}
