import { BranchPlace, HrPolicy, LeaveType } from './types';

/**
 * The defaults a new company starts with — every figure editable on
 * People → Holidays & policies.
 *
 * Statutory figures are the commonly published ones (PF 12% on a ₹15,000
 * wage ceiling, EPS 8.33%, ESI 0.75% / 3.25% up to ₹21,000 gross, Andhra
 * Pradesh and Maharashtra professional tax). They change by notification;
 * have the company's CA confirm them before the first real payroll.
 */

export const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  { code: 'CL', name: 'Casual leave', annualQuota: 12, carryForwardMax: 0, paid: true, allowBackdated: false, emoji: '🌤️', hue: '#2f6fd6' },
  { code: 'SL', name: 'Sick leave', annualQuota: 12, carryForwardMax: 0, paid: true, allowBackdated: true, emoji: '🤒', hue: '#c0365f' },
  { code: 'EL', name: 'Earned leave', annualQuota: 15, carryForwardMax: 30, paid: true, allowBackdated: false, emoji: '🌴', hue: '#1c8a5e' },
  { code: 'LOP', name: 'Unpaid leave', annualQuota: 0, carryForwardMax: 0, paid: false, allowBackdated: true, emoji: '🕳️', hue: '#6b7686' },
];

export const DEFAULT_POLICY: HrPolicy = {
  shiftStart: '09:30',
  shiftEnd: '18:30',
  graceMinutes: 15,
  fullDayMinutes: 8 * 60,
  halfDayMinutes: 4 * 60,
  geofenceMeters: 300,
  weeklyOffs: [0],
  alternateSaturdaysOff: true,
  leaveTypes: DEFAULT_LEAVE_TYPES,
  pfRatePct: 12,
  pfWageCeilingPaise: 15_000_00,
  epsRatePct: 8.33,
  esiEmployeePct: 0.75,
  esiEmployerPct: 3.25,
  esiGrossLimitPaise: 21_000_00,
  ptTables: [
    {
      state: 'Andhra Pradesh',
      slabs: [
        { upToPaise: 15_000_00, taxPaise: 0 },
        { upToPaise: 20_000_00, taxPaise: 150_00 },
        { upToPaise: null, taxPaise: 200_00 },
      ],
    },
    {
      state: 'Maharashtra',
      womenExemptUpToPaise: 25_000_00,
      slabs: [
        { upToPaise: 7_500_00, taxPaise: 0 },
        { upToPaise: 10_000_00, taxPaise: 175_00 },
        { upToPaise: null, taxPaise: 200_00, februaryTaxPaise: 300_00 },
      ],
    },
  ],
};

/**
 * Where each branch is, for checking a check-in against it. The office's
 * own point, set on People → Holidays & policies; these are city centres
 * until someone stands in the office and saves the real one.
 */
export const DEFAULT_BRANCH_PLACES: BranchPlace[] = [
  { code: 'VZG', name: 'Visakhapatnam (HO)', city: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lng: 83.2185 },
  { code: 'VJA', name: 'Vijayawada', city: 'Vijayawada', state: 'Andhra Pradesh', lat: 16.5062, lng: 80.648 },
  { code: 'NSK', name: 'Nashik', city: 'Nashik', state: 'Maharashtra', lat: 19.9975, lng: 73.7898 },
  { code: 'PUN', name: 'Pune', city: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
  { code: 'GDM', name: 'Gandhidham', city: 'Gandhidham', state: 'Gujarat', lat: 23.0753, lng: 70.1337 },
  { code: 'HSR', name: 'Hosur', city: 'Hosur', state: 'Tamil Nadu', lat: 12.7409, lng: 77.8253 },
];

export const DEPARTMENTS = ['Leadership', 'Operations', 'Compliance', 'Finance', 'Business development', 'People', 'Administration', 'Field'];

export const EMPLOYMENT_LABEL = { FULL_TIME: 'Full time', CONTRACT: 'Contract', INTERN: 'Intern' } as const;
export const EMPLOYEE_STATUS_LABEL = { ACTIVE: 'Active', ON_NOTICE: 'On notice', EXITED: 'Left' } as const;
