import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// The shared database, as a map: HGET, HSET, HMGET and HGETALL are all this uses.
const store = vi.hoisted(() => new Map<string, string>());
vi.mock('./people-store', () => ({
  command: vi.fn(async (args: string[]) => {
    const [cmd, , ...rest] = args;
    if (cmd === 'HGET') return store.get(rest[0]) ?? null;
    if (cmd === 'HSET') {
      store.set(rest[0], rest[1]);
      return 1;
    }
    if (cmd === 'HMGET') return rest.map((k) => store.get(k) ?? null);
    if (cmd === 'HGETALL') return [...store.entries()].flat();
    return null;
  }),
}));

import { PingRefused, gpsSummary, keepPosition, positionsOf, readPing, truckKey, type PingRequest } from './gps';

const KEY = 'device-key-for-tests-0123';
const NOW = Date.parse('2026-10-26T10:00:00Z');

const req = (over: Partial<PingRequest>): PingRequest => ({
  raw: '',
  contentType: '',
  query: {},
  signature: null,
  bearer: null,
  ...over,
});

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof PingRefused ? `${e.status} ${e.message}` : String(e);
  }
  return 'accepted';
};

describe('a position report', () => {
  it('is read from a phone app (OsmAnd: id, lat, lon, timestamp, speed in knots)', () => {
    const p = readPing(
      req({ query: { key: KEY, id: 'mh12qr8841', lat: '18.5204', lon: '73.8567', timestamp: String(NOW / 1000 - 60), speed: '27' } }),
      KEY,
      NOW,
    );
    expect(p).toMatchObject({ vehicleNo: 'MH12QR8841', lat: 18.5204, lng: 73.8567, speedKmph: 50 });
    expect(p.at).toBe('2026-10-26T09:59:00.000Z');
  });

  it('is read from a GPS unit as JSON, signed the backend’s way', () => {
    const raw = JSON.stringify({ vehicleNo: 'MH 04 TT 2019', at: new Date(NOW - 30_000).toISOString(), lat: 26.9, lng: 75.8, speedKmph: 62, fuelPct: 40 });
    const signature = createHmac('sha256', KEY).update(raw).digest('hex');
    expect(readPing(req({ raw, contentType: 'application/json', signature }), KEY, NOW)).toMatchObject({
      vehicleNo: 'MH 04 TT 2019',
      speedKmph: 62,
      fuelPct: 40,
    });
  });

  it('is taken with the key as a Bearer header', () => {
    const raw = JSON.stringify({ vehicleNo: 'GJ12AT7745', lat: 23.0, lng: 72.5 });
    expect(readPing(req({ raw, bearer: KEY }), KEY, NOW).at).toBe(new Date(NOW).toISOString());
  });

  it('is refused without the key, with a wrong key or a wrong signature', () => {
    const q = { id: 'MH12QR8841', lat: '18.5', lon: '73.8' };
    expect(refusal(() => readPing(req({ query: q }), KEY, NOW))).toMatch(/^401 Send the device key/);
    expect(refusal(() => readPing(req({ query: { ...q, key: 'guess' } }), KEY, NOW))).toMatch(/^401 The device key is wrong/);
    const raw = JSON.stringify({ vehicleNo: 'MH12QR8841', at: new Date(NOW).toISOString(), lat: 18.5, lng: 73.8 });
    expect(refusal(() => readPing(req({ raw, signature: 'ab'.repeat(32) }), KEY, NOW))).toMatch(/^401 The signature/);
  });

  it('is refused when signed but stale — a replayed report', () => {
    const raw = JSON.stringify({ vehicleNo: 'MH12QR8841', at: new Date(NOW - 10 * 60_000).toISOString(), lat: 18.5, lng: 73.8 });
    const signature = createHmac('sha256', KEY).update(raw).digest('hex');
    expect(refusal(() => readPing(req({ raw, signature }), KEY, NOW))).toMatch(/^401 .*5 minutes/);
  });

  it('is refused when it is not a real position or names no truck', () => {
    const at = (q: Record<string, string>) => refusal(() => readPing(req({ query: { key: KEY, ...q } }), KEY, NOW));
    expect(at({ id: 'MH12QR8841', lat: '0', lon: '0' })).toMatch(/^400 A position/);
    expect(at({ id: 'MH12QR8841', lat: '95', lon: '73' })).toMatch(/^400 A position/);
    expect(at({ id: 'MH', lat: '18.5', lon: '73.8' })).toMatch(/^400 Say which truck/);
    expect(at({ id: 'MH12QR8841', lat: '18.5', lon: '73.8', timestamp: String(NOW / 1000 + 3600) })).toMatch(/future/);
    expect(at({ id: 'MH12QR8841', lat: '18.5', lon: '73.8', timestamp: String(NOW / 1000 - 4 * 86400) })).toMatch(/3 days/);
  });
});

describe('kept positions', () => {
  it('are one per truck however its number is written, and a late older report does not replace a newer one', async () => {
    store.clear();
    const base = { lat: 18.5, lng: 73.8, speedKmph: 40, fuelPct: null, receivedAt: new Date(NOW).toISOString() };
    expect(await keepPosition({ ...base, vehicleNo: 'MH12QR8841', at: '2026-10-26T09:59:00.000Z' })).toBe('kept');
    expect(await keepPosition({ ...base, vehicleNo: 'MH 12 QR 8841', at: '2026-10-26T09:50:00.000Z' })).toBe('older');
    const found = await positionsOf(['MH 12 QR 8841', 'KA01AB1234']);
    expect(Object.keys(found)).toEqual(['MH 12 QR 8841']);
    expect(found['MH 12 QR 8841'].at).toBe('2026-10-26T09:59:00.000Z');
    expect(truckKey('mh-12 qr 8841')).toBe('MH12QR8841');
    expect((await gpsSummary()).count).toBe(1);
  });
});
