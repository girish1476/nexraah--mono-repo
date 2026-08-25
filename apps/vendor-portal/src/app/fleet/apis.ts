import { ApiResponse, request } from '@/apis';
import { USE_MOCK, mock } from '@/lib/mock';
import { FleetVehicle, VehicleInput } from './types';

const FIXTURES: FleetVehicle[] = [
  {
    id: 'VH-4482',
    registrationNo: 'MH 15 GT 4482',
    truckType: '32 ft SXL',
    capacityKg: 21000,
    currentCity: 'Nashik',
    status: 'ON_TRIP',
    freeFrom: '2026-08-15',
    docsDue: null,
  },
  {
    id: 'VH-9034',
    registrationNo: 'MH 04 KL 9034',
    truckType: '22 ft container',
    capacityKg: 9000,
    currentCity: 'Thane',
    status: 'AVAILABLE',
    freeFrom: null,
    docsDue: null,
  },
  {
    id: 'VH-7721',
    registrationNo: 'MH 12 RB 7721',
    truckType: '40 ft trailer',
    capacityKg: 24000,
    currentCity: 'Pune',
    status: 'DOCS_DUE',
    freeFrom: null,
    docsDue: {
      documentKind: 'FITNESS',
      documentLabel: 'Fitness certificate',
      expiredOn: '2026-08-02',
    },
  },
  {
    id: 'VH-2207',
    registrationNo: 'MH 15 EE 2207',
    truckType: 'Open body',
    capacityKg: 16000,
    currentCity: 'Nashik',
    status: 'MAINTENANCE',
    freeFrom: null,
    docsDue: null,
  },
];

export function getFleet() {
  if (USE_MOCK) return mock(FIXTURES);
  return request<ApiResponse<FleetVehicle[]>>({ url: '/portal/fleet', method: 'GET' }).then(
    (r) => r.data,
  );
}

export function addVehicle(body: VehicleInput) {
  if (USE_MOCK) {
    // Static mock, same contract as every other apis.ts (e.g.
    // loads/apis.ts's placeQuote): resolves a synthetic result without
    // mutating FIXTURES, so a refetch always comes back looking like the
    // seeded table (see e2e/fleet.spec.ts's header comment).
    const vehicle: FleetVehicle = {
      id: `VH-${Date.now().toString(36).toUpperCase()}`,
      registrationNo: body.registrationNo,
      truckType: body.truckType,
      capacityKg: body.capacityKg,
      currentCity: body.currentCity ?? null,
      status: body.status,
      freeFrom: body.freeFrom ?? null,
      docsDue: null,
    };
    return mock<FleetVehicle>(vehicle);
  }
  return request<ApiResponse<FleetVehicle>>({
    url: '/portal/fleet',
    method: 'POST',
    data: body,
  }).then((r) => r.data);
}

export function updateVehicle(id: string, body: Partial<VehicleInput>) {
  if (USE_MOCK) {
    return mock<void>(undefined);
  }
  return request<ApiResponse<FleetVehicle>>({
    url: `/portal/fleet/${id}`,
    method: 'PATCH',
    data: body,
  }).then(() => undefined);
}
