import { beforeEach, describe, expect, it, vi } from 'vitest';

// What the console's server would answer: one live report for MH 04 TT 2019.
const live = vi.hoisted(() => ({ positions: {} as Record<string, unknown> }));
vi.mock('../lib/live-gps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/live-gps')>()),
  livePositions: vi.fn(async (vehicles: string[]) =>
    Object.fromEntries(vehicles.filter((v) => v in live.positions).map((v) => [v, live.positions[v]])),
  ),
}));

import { mintAccessToken, mockAdapter } from './index';
import { db } from './db';

const call = async (url: string) => {
  localStorage.setItem('token', mintAccessToken('OPS'));
  const res = await mockAdapter({ method: 'GET', url, headers: {} } as never);
  return (res.data as { data: any }).data;
};

const VEHICLE = 'MH 04 TT 2019';
const report = (minutesAgo: number, speedKmph: number) => ({
  vehicleNo: VEHICLE,
  lat: 26.9124,
  lng: 75.7873,
  at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  speedKmph,
  fuelPct: 41,
});

describe('live GPS over the saved records', () => {
  beforeEach(() => {
    live.positions = {};
  });

  it('puts a truck on the road at its reported place, as its newest update', async () => {
    const trip = db.trips.find((t: any) => t.vehicleNo === VEHICLE)!;
    trip.departedAt = new Date(Date.now() - 86_400_000).toISOString();
    delete trip.deliveredAt;

    const before = await call(`/trips/${trip.id}/tracking`);
    live.positions[VEHICLE] = report(2, 64);
    const after = await call(`/trips/${trip.id}/tracking`);

    expect(after.updates).toHaveLength(before.updates.length + 1);
    expect(after.updates.at(-1)).toMatchObject({
      id: 'gps-live',
      kind: 'UPDATE',
      lat: 26.9124,
      lng: 75.7873,
      status: 'MOVING',
      recordedByName: 'GPS',
      note: '64 km/h',
    });
    // Laid over, never saved: the record itself is unchanged.
    expect(db.tripTracking.some((u: any) => u.id === 'gps-live')).toBe(false);
  });

  it('moves the fleet board row, and checks its speed against the limit again', async () => {
    live.positions[VEHICLE] = report(1, db.config.overspeed_kmph + 10);
    const board = await call('/telematics');
    const row = board.vehicles.find((v: any) => v.vehicleNo === VEHICLE);
    expect(row).toMatchObject({ lat: 26.9124, lng: 75.7873, fuelPct: 41, lastUpdatedBy: 'GPS' });
    expect(row.alerts).toContain('OVERSPEED');
    expect(row.alerts).not.toContain('DARK_VEHICLE');

    live.positions[VEHICLE] = report(1, 30);
    const calm = (await call(`/telematics/vehicles/${encodeURIComponent(VEHICLE)}`)) as any;
    expect(calm.alerts).not.toContain('OVERSPEED');
  });

  it('leaves a row alone when the report is older than what is already there', async () => {
    const saved = db.telematics.find((v: any) => v.vehicleNo === VEHICLE)!;
    live.positions[VEHICLE] = { ...report(0, 50), at: new Date(Date.parse(saved.lastPingAt) - 3_600_000).toISOString() };
    const row = (await call('/telematics')).vehicles.find((v: any) => v.vehicleNo === VEHICLE);
    expect(row.lat).toBe(saved.lat);
  });
});
