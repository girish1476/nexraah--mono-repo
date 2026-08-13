import { ApiResponse, request } from '@/apis';
import { USE_MOCK, mock } from '@/lib/mock';
import { Profile } from './types';

const FIXTURE: Profile = {
  vendorCode: 'V-2214',
  companyName: 'Rathod Roadlines',
  contactName: 'Sandeep Rathod',
  phone: '98220 41xx',
  city: 'Nashik',
  gstin: '27AABCR1234M1Z5',
  panMasked: 'AABCR****M',
  aadhaarLast4: '4471',
  bankAccountMasked: '••••••7741',
  bankIfsc: 'SBIN0001234',
  advancePolicyPct: 40,
  business: { trips: 128, valuePaise: 742000000, outstandingPaise: 5336000 },
  documents: [
    {
      group: 'Identity — verified once, not per load',
      documents: [
        { kind: 'PAN_CARD', label: 'PAN card photo', status: 'VERIFIED', rejectionReason: null, rejectedOn: null, expiredOn: null, groundsVehicleRegistrationNo: null, capture: true, needsGeotag: false },
        { kind: 'AADHAAR_CARD', label: 'Aadhaar card photo', status: 'VERIFIED', rejectionReason: null, rejectedOn: null, expiredOn: null, groundsVehicleRegistrationNo: null, capture: true, needsGeotag: false },
        { kind: 'SELFIE', label: 'Geo-stamped selfie', status: 'VERIFIED', rejectionReason: null, rejectedOn: null, expiredOn: null, groundsVehicleRegistrationNo: null, capture: true, needsGeotag: true },
        { kind: 'ADDRESS_PROOF', label: 'Address proof', status: 'REJECTED', rejectionReason: 'Electricity bill is more than three months old.', rejectedOn: '2026-08-03', expiredOn: null, groundsVehicleRegistrationNo: null, capture: false, needsGeotag: false },
      ],
    },
    {
      group: 'Company & banking',
      documents: [
        { kind: 'CANCELLED_CHEQUE', label: 'Cancelled cheque', status: 'VERIFIED', rejectionReason: null, rejectedOn: null, expiredOn: null, groundsVehicleRegistrationNo: null, capture: false, needsGeotag: false },
        { kind: 'MSME', label: 'MSME certificate', status: 'PENDING', rejectionReason: null, rejectedOn: null, expiredOn: null, groundsVehicleRegistrationNo: null, capture: false, needsGeotag: false },
        { kind: 'AGREEMENT', label: 'Signed transporter agreement', status: 'MISSING', rejectionReason: null, rejectedOn: null, expiredOn: null, groundsVehicleRegistrationNo: null, capture: false, needsGeotag: false },
      ],
    },
    {
      group: 'Vehicle documents — these gate the advance',
      documents: [
        { kind: 'RC', label: 'Registration certificate', status: 'PENDING', rejectionReason: null, rejectedOn: null, expiredOn: null, groundsVehicleRegistrationNo: null, capture: true, needsGeotag: false },
        { kind: 'FITNESS', label: 'Fitness certificate', status: 'EXPIRED', rejectionReason: null, rejectedOn: null, expiredOn: '2026-08-02', groundsVehicleRegistrationNo: 'MH 12 RB 7721', capture: true, needsGeotag: false },
        { kind: 'INSURANCE', label: 'Insurance', status: 'VERIFIED', rejectionReason: null, rejectedOn: null, expiredOn: null, groundsVehicleRegistrationNo: null, capture: true, needsGeotag: false },
        { kind: 'PUC', label: 'PUC certificate', status: 'VERIFIED', rejectionReason: null, rejectedOn: null, expiredOn: null, groundsVehicleRegistrationNo: null, capture: true, needsGeotag: false },
        { kind: 'DL', label: 'Driving licence — Sandeep Rathod', status: 'MISSING', rejectionReason: null, rejectedOn: null, expiredOn: null, groundsVehicleRegistrationNo: null, capture: true, needsGeotag: false },
      ],
    },
  ],
};

export function getProfile() {
  if (USE_MOCK) return mock(FIXTURE);
  return request<ApiResponse<Profile>>({ url: '/portal/profile', method: 'GET' }).then(
    (r) => r.data,
  );
}

export function uploadDocument(
  kind: string,
  file: File,
  geo?: { latitude: number; longitude: number },
) {
  if (USE_MOCK) return mock<void>(undefined, 500);
  const form = new FormData();
  form.append('file', file);
  if (geo) {
    form.append('latitude', String(geo.latitude));
    form.append('longitude', String(geo.longitude));
  }
  return request<ApiResponse<void>>({
    url: `/portal/profile/documents/${kind}`,
    method: 'POST',
    data: form,
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(() => undefined);
}
