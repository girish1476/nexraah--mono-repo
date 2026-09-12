import { ApiResponse, idempotent, request } from '@/apis';
import { USE_MOCK, mock } from '@/lib/mock';
import { Load, PlaceQuoteRequest, PlaceQuoteResult, TruckType, Vehicle } from './types';

const FIXTURES: Load[] = [
  {
    code: 'LD-4471',
    originCity: 'Bhiwandi',
    destinationCity: 'Hyderabad',
    truckType: '32 ft SXL',
    weightKg: 21000,
    goods: 'CR steel coils',
    distanceKm: 712,
    transitDays: 2,
    reportingRule: 'SAME_DAY',
    remarks: 'Reporting 06:00 at the plant gate',
    pickupAt: '2026-08-11T06:00:00+05:30',
    bandLowPaise: 3800000,
    bandHighPaise: 4250000,
    advancePct: 40,
    myQuote: null,
  },
  {
    code: 'LD-4468',
    originCity: 'Chakan',
    destinationCity: 'Coimbatore',
    truckType: '22 ft container',
    weightKg: 9000,
    goods: 'Auto components',
    distanceKm: 1088,
    transitDays: 3,
    reportingRule: 'NEXT_DAY',
    remarks: null,
    pickupAt: '2026-08-11T14:00:00+05:30',
    bandLowPaise: 2950000,
    bandHighPaise: 3300000,
    advancePct: 40,
    myQuote: null,
  },
  {
    code: 'LD-4462',
    originCity: 'Mundra',
    destinationCity: 'Jaipur',
    truckType: '40 ft trailer',
    weightKg: 24000,
    goods: 'Imported machinery',
    distanceKm: 906,
    transitDays: 3,
    reportingRule: 'SCHEDULED',
    remarks: 'Customs-cleared cargo, seal intact',
    pickupAt: '2026-08-12T08:00:00+05:30',
    bandLowPaise: 4700000,
    bandHighPaise: 5200000,
    advancePct: 40,
    myQuote: null,
  },
  {
    code: 'LD-4459',
    originCity: 'Hosur',
    destinationCity: 'Gurugram',
    truckType: '32 ft SXL',
    weightKg: 18000,
    goods: 'Refrigerators',
    distanceKm: 2166,
    transitDays: 5,
    reportingRule: 'SAME_DAY',
    remarks: null,
    pickupAt: '2026-08-12T05:00:00+05:30',
    bandLowPaise: 6100000,
    bandHighPaise: 6750000,
    advancePct: 40,
    myQuote: null,
  },
];

export function getLoads(truckTypes: TruckType[] = []) {
  if (USE_MOCK) {
    return mock(
      FIXTURES.filter((l) => !truckTypes.length || truckTypes.includes(l.truckType)),
    );
  }
  return request<ApiResponse<Load[]>>({
    url: '/portal/loads',
    method: 'GET',
    params: truckTypes.length ? { truckType: truckTypes.join(',') } : undefined,
  }).then((r) => r.data);
}

export function getLoad(code: string) {
  if (USE_MOCK) {
    const found = FIXTURES.find((l) => l.code === code);
    if (!found) return Promise.reject(new Error('Load not found'));
    return mock(found);
  }
  return request<ApiResponse<Load>>({
    url: `/portal/loads/${code}`,
    method: 'GET',
  }).then((r) => r.data);
}

/** Quote form needs something to quote with — availability gates the list (part 04). */
export function getQuotableVehicles() {
  if (USE_MOCK) {
    return mock<Vehicle[]>([
      { id: 'VH-9034', registrationNo: 'MH 04 KL 9034', truckType: '22 ft container', capacityKg: 9000 },
      { id: 'VH-2207', registrationNo: 'MH 15 EE 2207', truckType: 'Open body', capacityKg: 16000 },
      { id: 'VH-7721', registrationNo: 'MH 12 RB 7721', truckType: '40 ft trailer', capacityKg: 24000 },
    ]);
  }
  return request<ApiResponse<Vehicle[]>>({
    url: '/portal/fleet',
    method: 'GET',
    params: { availability: 'AVAILABLE' },
  }).then((r) => r.data);
}

/** Retry-safety contract as `attachPod` — `idempotencyKey` is the caller's. */
export function placeQuote(code: string, body: PlaceQuoteRequest, idempotencyKey: string) {
  if (USE_MOCK) {
    const load = FIXTURES.find((l) => l.code === code)!;
    const aboveBand = body.amountPaise > load.bandHighPaise;
    return mock<PlaceQuoteResult>({
      id: 'QT-MOCK-1',
      loadCode: code,
      amountPaise: body.amountPaise,
      status: aboveBand ? 'PENDING_APPROVAL' : 'SUBMITTED',
      aboveBand,
    });
  }
  return idempotent<ApiResponse<PlaceQuoteResult>>(idempotencyKey, {
    url: `/portal/loads/${code}/quote`,
    method: 'POST',
    data: body,
  }).then((r) => r.data);
}
