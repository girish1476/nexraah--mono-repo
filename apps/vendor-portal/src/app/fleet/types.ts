import type { TruckType } from '@/app/loads/types';

/** `DOCS_DUE` is system-set (part 04 §2) — the other three are the transporter's. */
export type VehicleStatus = 'AVAILABLE' | 'ON_TRIP' | 'DOCS_DUE' | 'MAINTENANCE';

export const SETTABLE_STATUSES: Exclude<VehicleStatus, 'DOCS_DUE'>[] = [
  'AVAILABLE',
  'ON_TRIP',
  'MAINTENANCE',
];

export const VEHICLE_STATUS_LABEL: Record<VehicleStatus, string> = {
  AVAILABLE: 'Available',
  ON_TRIP: 'On trip',
  DOCS_DUE: 'Docs due',
  MAINTENANCE: 'Maintenance',
};

export interface FleetVehicle {
  id: string;
  registrationNo: string;
  truckType: TruckType;
  capacityKg: number;
  currentCity: string | null;
  status: VehicleStatus;
  freeFrom: string | null;
  /** Set only while DOCS_DUE — which paper lapsed and when. */
  docsDue: { documentKind: string; documentLabel: string; expiredOn: string } | null;
}

export interface VehicleInput {
  registrationNo: string;
  truckType: TruckType;
  capacityKg: number;
  currentCity?: string;
  status: Exclude<VehicleStatus, 'DOCS_DUE'>;
  freeFrom?: string;
}
