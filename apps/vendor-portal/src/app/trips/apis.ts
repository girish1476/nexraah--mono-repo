import { ApiResponse, idempotent, request } from '@/apis';
import { USE_MOCK, mock } from '@/lib/mock';
import {
  AttachPodRequest,
  BillDraft,
  BillResult,
  LorryReceipt,
  Trip,
  TripStatus,
} from './types';

const FIXTURES: Trip[] = [
  {
    id: 'TR-20881',
    lrNo: 'NXR/LR/26/0884',
    originCity: 'Nashik',
    destinationCity: 'Kolkata',
    distanceKm: 1912,
    status: 'PLACED',
    podStatus: 'PENDING',
    podRejectionReason: null,
    vehicleRegistrationNo: 'MH 15 GT 4482',
    driverName: 'Sandeep Rathod',
    driverPhone: '98220 41xx',
    freightPaise: 5840000,
    advancePct: 40,
    advancePaise: 2336000,
    advanceReleasedAt: null,
    advanceUtr: null,
    advanceBlockers: [
      { what: 'Driving licence not on file', why: 'Nothing uploaded for Sandeep Rathod' },
      { what: 'Registration certificate unverified', why: 'Uploaded 11 Aug — with compliance' },
      { what: 'E-way bill missing', why: 'Required before the truck leaves the plant' },
    ],
    balancePaise: 3504000,
    penaltyPaise: 0,
    netPayablePaise: 3504000,
    deliveredAt: null,
    podDaysElapsed: null,
    podPenaltyPerDayPaise: 10000,
    billId: null,
    milestones: [
      { key: 'PLACED', label: 'Placement confirmed', at: '2026-08-10T18:40:00+05:30', done: true },
      { key: 'REPORTED', label: 'Reported at plant', at: '2026-08-11T05:52:00+05:30', done: true },
      { key: 'LOADED', label: 'Loaded, LR issued', at: '2026-08-11T09:15:00+05:30', done: true },
      { key: 'IN_TRANSIT', label: 'In transit', at: null, done: false },
      { key: 'DELIVERED', label: 'Delivered at Kolkata', at: null, done: false },
      { key: 'POD', label: 'POD awaited', at: null, done: false },
    ],
  },
  {
    id: 'TR-20874',
    lrNo: 'NXR/LR/26/0871',
    originCity: 'Chakan',
    destinationCity: 'Coimbatore',
    distanceKm: 1088,
    status: 'DELIVERED',
    podStatus: 'REJECTED',
    podRejectionReason: 'Consignee stamp missing on the reverse.',
    vehicleRegistrationNo: 'MH 04 KL 9034',
    driverName: 'Imran Shaikh',
    driverPhone: '99870 12xx',
    freightPaise: 3120000,
    advancePct: 40,
    advancePaise: 1248000,
    advanceReleasedAt: '2026-07-22T11:05:00+05:30',
    advanceUtr: 'HDFC0004471829',
    advanceBlockers: [],
    balancePaise: 1872000,
    penaltyPaise: 40000,
    netPayablePaise: 1832000,
    deliveredAt: '2026-07-22T16:20:00+05:30',
    podDaysElapsed: 24,
    podPenaltyPerDayPaise: 10000,
    billId: null,
    milestones: [
      { key: 'PLACED', label: 'Placement confirmed', at: '2026-07-18T10:00:00+05:30', done: true },
      { key: 'REPORTED', label: 'Reported at plant', at: '2026-07-18T14:10:00+05:30', done: true },
      { key: 'LOADED', label: 'Loaded, LR issued', at: '2026-07-18T17:30:00+05:30', done: true },
      { key: 'IN_TRANSIT', label: 'In transit', at: '2026-07-19T06:00:00+05:30', done: true },
      { key: 'DELIVERED', label: 'Delivered at Coimbatore', at: '2026-07-22T16:20:00+05:30', done: true },
      { key: 'POD', label: 'POD rejected — re-attach', at: null, done: false },
    ],
  },
  {
    id: 'TR-20860',
    lrNo: 'NXR/LR/26/0855',
    originCity: 'Pune',
    destinationCity: 'Indore',
    distanceKm: 585,
    status: 'CLOSED',
    podStatus: 'APPROVED',
    podRejectionReason: null,
    vehicleRegistrationNo: 'GJ 12 AT 3390',
    driverName: 'Ravi Pawar',
    driverPhone: '90110 88xx',
    freightPaise: 2265000,
    advancePct: 40,
    advancePaise: 906000,
    advanceReleasedAt: '2026-07-04T09:40:00+05:30',
    advanceUtr: 'SBIN26070441721',
    advanceBlockers: [],
    balancePaise: 1359000,
    penaltyPaise: 0,
    netPayablePaise: 1359000,
    deliveredAt: '2026-07-08T12:00:00+05:30',
    podDaysElapsed: 6,
    podPenaltyPerDayPaise: 10000,
    billId: null,
    milestones: [
      { key: 'PLACED', label: 'Placement confirmed', at: '2026-07-02T09:00:00+05:30', done: true },
      { key: 'REPORTED', label: 'Reported at plant', at: '2026-07-02T13:00:00+05:30', done: true },
      { key: 'LOADED', label: 'Loaded, LR issued', at: '2026-07-02T15:20:00+05:30', done: true },
      { key: 'IN_TRANSIT', label: 'In transit', at: '2026-07-03T06:30:00+05:30', done: true },
      { key: 'DELIVERED', label: 'Delivered at Indore', at: '2026-07-08T12:00:00+05:30', done: true },
      { key: 'POD', label: 'POD approved', at: '2026-07-15T10:15:00+05:30', done: true },
    ],
  },
];

export function getTrips(statuses: TripStatus[] = []) {
  if (USE_MOCK) {
    return mock(FIXTURES.filter((t) => !statuses.length || statuses.includes(t.status)));
  }
  return request<ApiResponse<Trip[]>>({
    url: '/portal/trips',
    method: 'GET',
    params: statuses.length ? { status: statuses.join(',') } : undefined,
  }).then((r) => r.data);
}

export function getTrip(id: string) {
  if (USE_MOCK) {
    const found = FIXTURES.find((t) => t.id === id);
    return found ? mock(found) : Promise.reject(new Error('Trip not found'));
  }
  return request<ApiResponse<Trip>>({ url: `/portal/trips/${id}`, method: 'GET' }).then(
    (r) => r.data,
  );
}

export function getLorryReceipt(id: string) {
  if (USE_MOCK) {
    const trip = FIXTURES.find((t) => t.id === id)!;
    return mock<LorryReceipt>({
      lrNo: trip.lrNo ?? 'NXR/LR/26/0884',
      issuedAt: '2026-08-11T09:15:00+05:30',
      originCity: trip.originCity,
      destinationCity: trip.destinationCity,
      goods: 'Decorative paint, 640 cartons',
      weightKg: 18000,
      truckType: '32 ft SXL',
      vehicleRegistrationNo: trip.vehicleRegistrationNo,
      driverName: trip.driverName,
      driverLicenceNo: 'MH15 20190004471',
      transitDays: 4,
      ewayBillNo: '4418 2290 7731',
      ewayValidUpto: '2026-08-16T23:59:00+05:30',
      freightPaise: trip.freightPaise,
      advancePaise: trip.advancePaise,
      balancePaise: trip.balancePaise,
      pdfUrl: '#',
    });
  }
  return request<ApiResponse<LorryReceipt>>({
    url: `/portal/trips/${id}/lorry-receipt`,
    method: 'GET',
  }).then((r) => r.data);
}

/**
 * `idempotencyKey` must be minted once per submission attempt by the caller
 * (`newIdempotencyKey()`) and passed unchanged on a retry of that same
 * attempt — never regenerated per HTTP call. Otherwise a network-drop retry
 * looks like a fresh request to the server and silently inserts a second
 * `pod_receipts` row, re-uploading every page.
 */
export function attachPod(id: string, body: AttachPodRequest, idempotencyKey: string) {
  if (USE_MOCK) return mock<void>(undefined, 600);
  const form = new FormData();
  body.files.forEach((f) => form.append('files', f));
  form.append('courierDocketNo', body.courierDocketNo);
  form.append('sentOn', body.sentOn);
  if (body.note) form.append('note', body.note);
  return idempotent<ApiResponse<void>>(idempotencyKey, {
    url: `/portal/trips/${id}/pod`,
    method: 'POST',
    data: form,
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(() => undefined);
}

export function getBillDraft(id: string) {
  if (USE_MOCK) {
    const trip = FIXTURES.find((t) => t.id === id)!;
    const approved = trip.podStatus === 'APPROVED';
    return mock<BillDraft>({
      tripId: id,
      submittable: approved,
      conditions: [
        { label: 'Trip delivered', met: trip.status === 'DELIVERED' || trip.status === 'CLOSED' },
        { label: 'Proof of delivery approved', met: approved },
      ],
      freightPaise: trip.freightPaise,
      agreedChargesPaise: 0,
      billTotalPaise: trip.netPayablePaise,
    });
  }
  return request<ApiResponse<BillDraft>>({
    url: `/portal/trips/${id}/bill`,
    method: 'GET',
  }).then((r) => r.data);
}

/** Same retry-safety contract as `attachPod` — `idempotencyKey` is the caller's. */
export function submitBill(
  id: string,
  body: { billNo: string; billDate: string; file: File },
  idempotencyKey: string,
) {
  if (USE_MOCK) {
    const trip = FIXTURES.find((t) => t.id === id)!;
    return mock<BillResult>({
      id: 'VBL-0091',
      billNo: body.billNo,
      computedBalancePaise: trip.netPayablePaise,
      billedPaise: trip.netPayablePaise + 40000,
      variancePaise: 40000,
    });
  }
  const form = new FormData();
  form.append('billNo', body.billNo);
  form.append('billDate', body.billDate);
  form.append('file', body.file);
  return idempotent<ApiResponse<BillResult>>(idempotencyKey, {
    url: `/portal/trips/${id}/bill`,
    method: 'POST',
    data: form,
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data);
}
