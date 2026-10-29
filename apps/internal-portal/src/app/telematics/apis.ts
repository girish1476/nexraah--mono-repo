import { request } from '@/apis';
import { livePositions, withLiveGps } from '@/lib/live-gps';
import { MOCKS_ENABLED } from '@/mocks';
import { TelematicsResponse, VehicleRow } from './types';

/**
 * GET /telematics — the live fleet board.
 *
 * Ingest is a provider webhook, `POST /telematics/ping`, HMAC-signed over the
 * raw body. It is not called from this application and carries no JWT.
 */
export async function getTelematics() {
  const board = await request<TelematicsResponse>({ url: '/telematics', method: 'GET' });
  // Live GPS reports (Control → Integrations → GPS tracking) laid over the API's rows.
  // The browser-only adapter does this itself.
  if (MOCKS_ENABLED) return board;
  const live = await livePositions(board.vehicles.map((v) => v.vehicleNo));
  return { ...board, vehicles: board.vehicles.map((v) => withLiveGps(v, live[v.vehicleNo], board.config.overspeedKmph)) };
}

/**
 * GET /telematics/vehicles/:vehicleNo — one vehicle's tracking, for the trip
 * detail screen. `null` means not on an open trip, or no signal ever
 * received — the trip page renders that as "not tracked yet", not an error.
 */
export async function getVehicleTracking(vehicleNo: string) {
  const row = await request<VehicleRow | null>({ url: `/telematics/vehicles/${encodeURIComponent(vehicleNo)}`, method: 'GET' });
  if (MOCKS_ENABLED || !row) return row;
  return withLiveGps(row, (await livePositions([vehicleNo]))[vehicleNo]);
}

/**
 * PATCH /telematics/vehicles/:vehicleNo — Ops keys in what they were told
 * over the phone. There is no GPS provider wired up; this is the only way a
 * row on the fleet board changes.
 */
export function updateVehicleTelematics(vehicleNo: string, patch: Partial<VehicleRow>) {
  return request<VehicleRow>({
    url: `/telematics/vehicles/${encodeURIComponent(vehicleNo)}`,
    method: 'PATCH',
    data: patch,
  });
}
