import { request } from '@/apis';
import { TelematicsResponse, VehicleRow } from './types';

/**
 * GET /telematics — the live fleet board.
 *
 * Ingest is a provider webhook, `POST /telematics/ping`, HMAC-signed over the
 * raw body. It is not called from this application and carries no JWT.
 */
export function getTelematics() {
  return request<TelematicsResponse>({ url: '/telematics', method: 'GET' });
}

/**
 * GET /telematics/vehicles/:vehicleNo — one vehicle's tracking, for the trip
 * detail screen. `null` means not on an open trip, or no signal ever
 * received — the trip page renders that as "not tracked yet", not an error.
 */
export function getVehicleTracking(vehicleNo: string) {
  return request<VehicleRow | null>({ url: `/telematics/vehicles/${encodeURIComponent(vehicleNo)}`, method: 'GET' });
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
