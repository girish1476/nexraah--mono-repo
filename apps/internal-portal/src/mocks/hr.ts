/**
 * HR in the browser — the stand-in for the HR API, the same way `index.ts`
 * stands in for the freight API.
 *
 * Kept in its own file and its own saved copy (`nexraah.hr.v1`), apart from
 * the freight data: the two never share a record, and HR's data can be reset
 * without touching anybody's loads.
 *
 * Sample people, attendance since September, leave, holidays and two
 * finished payroll months are made on first use, so every screen has
 * something real to show. Attendance keeps filling itself in up to
 * yesterday for the sample staff, so the demo never goes stale. People who
 * have a console login are never checked in by the demo: their today is
 * theirs to mark.
 */

import { RoleCode, SEED_GRANTS, type Permission } from '@/lib/permissions';
import { ACCOUNTS } from './db';
import { dayFor, holidayOn, isWeeklyOff, leaveOn, metresBetween, summarise } from '@/lib/hr/attendance';
import {
  addDays,
  dateLabel,
  datesBetween,
  datesOfMonth,
  daysInMonth,
  istDate,
  istMinutes,
  istMoment,
  monthLabel,
  monthOf,
  shiftMonth,
  yearsBetween,
} from '@/lib/hr/calendar';
import { balances, leaveDays, leaveProblem, leaveYearOf } from '@/lib/hr/leave';
import { bankFileCsv, computePay, monthlyGross, suggestStructure } from '@/lib/hr/payroll';
import { DEFAULT_BRANCH_PLACES, DEFAULT_POLICY } from '@/lib/hr/policy';
import type {
  AttendanceDay,
  AttendanceRecord,
  BankAccount,
  BranchPlace,
  Correction,
  Employee,
  EmployeeView,
  Holiday,
  HrPolicy,
  LeaveRequest,
  PayrollRun,
  Payslip,
  PayslipRow,
  PendingItem,
  ProfileChange,
} from '@/lib/hr/types';

/* ---- errors, in the shape the adapter turns into an API error ----------- */

class HrError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
function fail(httpStatus: number, code: string, message: string, details?: unknown): never {
  throw new HrError(httpStatus, code, message, details);
}

export interface HrCtx {
  params: string[];
  query: URLSearchParams;
  body: any;
  role: RoleCode;
  userId: string;
}
type HrHandler = (ctx: HrCtx) => unknown;

/* ---- the data ----------------------------------------------------------- */

interface HrDb {
  version: 1;
  employees: Employee[];
  records: AttendanceRecord[];
  corrections: Correction[];
  leaves: LeaveRequest[];
  holidays: Holiday[];
  policy: HrPolicy;
  places: BranchPlace[];
  runs: PayrollRun[];
  payslips: Payslip[];
  changes: ProfileChange[];
  /** Leave carried in from last year, per person per type. */
  carried: Record<string, Record<string, number>>;
  /** Sample attendance is filled in up to and including this date. */
  filledUntil: string;
  seq: number;
}

const STORE_KEY = 'nexraah.hr.v1';
let hr: HrDb | null = null;

const storage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

function load(): HrDb {
  if (hr) return hr;
  try {
    const raw = storage()?.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as HrDb;
      if (saved?.version === 1 && Array.isArray(saved.employees)) hr = saved;
    }
  } catch {
    // A corrupt copy is not worth refusing to start: begin again from the sample.
  }
  if (!hr) hr = seed();
  fillAttendance(hr);
  return hr;
}

function save(): void {
  if (!hr) return;
  try {
    storage()?.setItem(STORE_KEY, JSON.stringify(hr));
  } catch {
    // Out of room or blocked: the work stays in this tab until the next save goes through.
  }
}

/** Starts HR's sample data over — for tests, and the settings page's reset. */
export function resetHr(): void {
  hr = null;
  try {
    storage()?.removeItem(STORE_KEY);
  } catch {
    /* nothing kept */
  }
}

const nowIso = () => new Date().toISOString();
const today = () => istDate(new Date());
const nextId = (db: HrDb, prefix: string) => `${prefix}-${++db.seq}`;

/* ---- deterministic sample randomness ------------------------------------ */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** A number in [0, 1) that is always the same for the same words. */
const chance = (...parts: string[]) => (hash(parts.join('|')) % 10_000) / 10_000;
const between = (lo: number, hi: number, ...parts: string[]) => lo + Math.floor(chance(...parts) * (hi - lo + 1));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/* ---- sample people ------------------------------------------------------ */

interface SampleSpec {
  id: string;
  userId: string | null;
  name: string;
  designation: string;
  department: string;
  branch: string;
  manager: string | null;
  joined: string;
  dob: string;
  gender: 'F' | 'M';
  grossRupees: number;
  tds?: number;
  type?: Employee['employmentType'];
  phone: string;
  email: string | null;
  bank: [string, string, string] | null;
  pan: string | null;
  uan: string | null;
  field?: boolean;
}

const SAMPLE: SampleSpec[] = [
  { id: 'e-vikram', userId: 'u-lead', name: 'Vikram Shah', designation: 'Director', department: 'Leadership', branch: 'VZG', manager: null, joined: '2019-06-03', dob: '1978-02-11', gender: 'M', grossRupees: 250_000, tds: 36_400, phone: '9820011206', email: 'vikram@nexraah.in', bank: ['HDFC Bank', '50100214471206', 'HDFC0000188'], pan: 'AKCPS4471K', uan: '100914471206' },
  { id: 'e-krishnan', userId: 'u-adm', name: 'S. Krishnan', designation: 'Systems administrator', department: 'Administration', branch: 'VZG', manager: 'e-vikram', joined: '2020-01-13', dob: '1985-07-22', gender: 'M', grossRupees: 90_000, phone: '9820011207', email: 'krishnan@nexraah.in', bank: ['ICICI Bank', '004101577207', 'ICIC0000041'], pan: 'BKZPK2207L', uan: '100914471207' },
  { id: 'e-swathi', userId: 'u-hr', name: 'Swathi Reddy', designation: 'HR manager', department: 'People', branch: 'VZG', manager: 'e-vikram', joined: '2021-04-05', dob: '1990-11-26', gender: 'F', grossRupees: 65_000, phone: '9820011209', email: 'swathi@nexraah.in', bank: ['State Bank of India', '30112447120', 'SBIN0000956'], pan: 'CRMPM1209Q', uan: '100914471209' },
  { id: 'e-anil', userId: 'u-ops', name: 'Anil Deshmukh', designation: 'Operations manager', department: 'Operations', branch: 'VZG', manager: 'e-vikram', joined: '2019-09-16', dob: '1984-05-02', gender: 'M', grossRupees: 85_000, phone: '9820011201', email: 'anil@nexraah.in', bank: ['HDFC Bank', '50100214471201', 'HDFC0000188'], pan: 'ADXPD1201F', uan: '100914471201' },
  { id: 'e-sunita', userId: 'u-ops-nsk', name: 'Sunita Rao', designation: 'Branch operations lead', department: 'Operations', branch: 'NSK', manager: 'e-anil', joined: '2022-02-01', dob: '1992-12-08', gender: 'F', grossRupees: 55_000, phone: '9820011202', email: 'sunita@nexraah.in', bank: ['Bank of Maharashtra', '60214471202', 'MAHB0000123'], pan: 'DLRPR1202H', uan: '100914471202' },
  { id: 'e-meera', userId: 'u-cmp', name: 'Meera Iyer', designation: 'Compliance executive', department: 'Compliance', branch: 'VZG', manager: 'e-vikram', joined: '2023-07-10', dob: '1995-03-19', gender: 'F', grossRupees: 45_000, phone: '9820011203', email: 'meera@nexraah.in', bank: ['Axis Bank', '921010014471203', 'UTIB0000552'], pan: 'EMIPI1203M', uan: '100914471203' },
  { id: 'e-rakesh', userId: 'u-fin', name: 'Rakesh Nair', designation: 'Finance manager', department: 'Finance', branch: 'VZG', manager: 'e-vikram', joined: '2020-08-24', dob: '1983-11-30', gender: 'M', grossRupees: 80_000, phone: '9820011204', email: 'rakesh@nexraah.in', bank: ['HDFC Bank', '50100214471204', 'HDFC0000188'], pan: 'FNRPN1204D', uan: '100914471204' },
  { id: 'e-neha', userId: 'u-bd', name: 'Neha Bhatt', designation: 'Business development manager', department: 'Business development', branch: 'VZG', manager: 'e-vikram', joined: '2022-11-14', dob: '1991-08-15', gender: 'F', grossRupees: 70_000, phone: '9820011205', email: 'neha@nexraah.in', bank: ['Kotak Mahindra Bank', '7412447120', 'KKBK0007461'], pan: 'GBHPB1205A', uan: '100914471205', field: true },
  { id: 'e-ravi', userId: 'u-lgs', name: 'Ravi Kumar', designation: 'Loading supervisor', department: 'Operations', branch: 'VZG', manager: 'e-anil', joined: '2023-01-09', dob: '1994-06-27', gender: 'M', grossRupees: 24_000, phone: '9820011208', email: 'ravi@nexraah.in', bank: ['State Bank of India', '30112447128', 'SBIN0000956'], pan: 'HRKPK1208B', uan: '100914471208' },
  { id: 'e-kiran', userId: null, name: 'Kiran Varma', designation: 'Operations executive', department: 'Operations', branch: 'VJA', manager: 'e-anil', joined: '2024-03-18', dob: '1997-01-04', gender: 'M', grossRupees: 32_000, phone: '9848022110', email: 'kiran@nexraah.in', bank: ['Andhra Bank (Union Bank)', '520101024471', 'UBIN0815225'], pan: 'JVKPV2110C', uan: '100914472110' },
  { id: 'e-farhan', userId: null, name: 'Farhan Shaikh', designation: 'Operations executive', department: 'Operations', branch: 'PUN', manager: 'e-anil', joined: '2024-06-03', dob: '1996-09-12', gender: 'M', grossRupees: 30_000, phone: '9822033451', email: 'farhan@nexraah.in', bank: ['HDFC Bank', '50100244713451', 'HDFC0000007'], pan: 'KSFPS3451E', uan: '100914473451' },
  { id: 'e-deepa', userId: null, name: 'Deepa Joshi', designation: 'Accounts executive', department: 'Finance', branch: 'VZG', manager: 'e-rakesh', joined: '2024-09-02', dob: '1998-04-21', gender: 'F', grossRupees: 28_000, phone: '9848044120', email: 'deepa@nexraah.in', bank: ['Axis Bank', '921010024474120', 'UTIB0000552'], pan: 'LJDPJ4120G', uan: '100914474120' },
  { id: 'e-arjun', userId: null, name: 'Arjun Reddy', designation: 'Field sales executive', department: 'Business development', branch: 'VZG', manager: 'e-neha', joined: '2025-02-17', dob: '1999-10-03', gender: 'M', grossRupees: 35_000, phone: '9848055231', email: 'arjun@nexraah.in', bank: ['ICICI Bank', '004101575231', 'ICIC0000041'], pan: 'MRAPR5231J', uan: '100914475231', field: true },
  { id: 'e-lakshmi', userId: null, name: 'Lakshmi Devi', designation: 'Office assistant', department: 'People', branch: 'VZG', manager: 'e-swathi', joined: '2023-05-15', dob: '1993-07-08', gender: 'F', grossRupees: 15_000, phone: '9848066342', email: null, bank: ['State Bank of India', '30112446342', 'SBIN0000956'], pan: null, uan: '100914476342' },
  { id: 'e-suresh', userId: null, name: 'Suresh Babu', designation: 'Driver', department: 'Field', branch: 'VZG', manager: 'e-ravi', joined: '2022-08-01', dob: '1988-12-19', gender: 'M', grossRupees: 19_500, phone: '9848077453', email: null, bank: ['Union Bank of India', '520101077453', 'UBIN0815225'], pan: 'NSBPB7453K', uan: '100914477453' },
  { id: 'e-mohan', userId: null, name: 'Mohan Rao', designation: 'Loading helper', department: 'Field', branch: 'VZG', manager: 'e-ravi', joined: '2026-10-12', dob: '2001-03-30', gender: 'M', grossRupees: 14_000, type: 'CONTRACT', phone: '9848088564', email: null, bank: null, pan: null, uan: null },
];

const SAMPLE_HOLIDAYS: [string, string][] = [
  ['2026-01-14', 'Sankranti'],
  ['2026-01-26', 'Republic Day'],
  ['2026-03-04', 'Holi'],
  ['2026-03-19', 'Ugadi'],
  ['2026-04-03', 'Good Friday'],
  ['2026-08-15', 'Independence Day'],
  ['2026-09-14', 'Vinayaka Chavithi'],
  ['2026-10-02', 'Gandhi Jayanti'],
  ['2026-10-20', 'Vijayadashami'],
  ['2026-11-09', 'Deepavali (day after)'],
  ['2026-12-25', 'Christmas'],
  ['2027-01-01', 'New Year’s Day'],
  ['2027-01-14', 'Sankranti'],
  ['2027-01-26', 'Republic Day'],
];

function seed(): HrDb {
  const db: HrDb = {
    version: 1,
    employees: [],
    records: [],
    corrections: [],
    leaves: [],
    holidays: SAMPLE_HOLIDAYS.map(([date, name], i) => ({ id: `hol-${i + 1}`, date, name, branches: null, optional: false })),
    policy: structuredClone(DEFAULT_POLICY),
    places: structuredClone(DEFAULT_BRANCH_PLACES),
    runs: [],
    payslips: [],
    changes: [],
    carried: {},
    filledUntil: '2026-08-31',
    seq: 100,
  };
  db.holidays.push({ id: 'hol-opt-1', date: '2026-11-24', name: 'Guru Nanak Jayanti (optional)', branches: null, optional: true });

  SAMPLE.forEach((s, i) => {
    const structure = suggestStructure(s.grossRupees * 100);
    db.employees.push({
      id: s.id,
      code: `NX-${String(i + 1).padStart(4, '0')}`,
      userId: s.userId,
      name: s.name,
      email: s.email,
      phone: s.phone,
      designation: s.designation,
      department: s.department,
      branchCode: s.branch,
      managerId: s.manager,
      joinedOn: s.joined,
      dob: s.dob,
      gender: s.gender,
      employmentType: s.type ?? 'FULL_TIME',
      status: 'ACTIVE',
      exitOn: null,
      pan: s.pan,
      uan: s.uan,
      esicNo: monthlyGross(structure) <= DEFAULT_POLICY.esiGrossLimitPaise ? `52${hash(s.id) % 1_000_000_000}` : null,
      address: `${between(1, 48, s.id, 'door')}-${between(1, 220, s.id, 'no')}, ${({ NSK: ['College Road', 'Gangapur Road'], PUN: ['Kothrud', 'Hadapsar'], VJA: ['Benz Circle', 'Labbipet'] } as Record<string, string[]>)[s.branch]?.[hash(s.id) % 2] ?? ['MVP Colony', 'Dwaraka Nagar', 'Gajuwaka', 'Seethammadhara', 'Madhurawada'][hash(s.id) % 5]}, ${s.branch === 'NSK' ? 'Nashik' : s.branch === 'PUN' ? 'Pune' : s.branch === 'VJA' ? 'Vijayawada' : 'Visakhapatnam'}`,
      bank: s.bank ? { holder: s.name, bank: s.bank[0], accountNo: s.bank[1], ifsc: s.bank[2] } : null,
      emergency: { name: `${['Ramesh', 'Lalitha', 'Srinivas', 'Kavitha'][hash(s.id) % 4]} ${s.name.split(' ').slice(-1)[0]}`, relation: ['Spouse', 'Father', 'Mother', 'Brother'][hash(s.id) % 4], phone: `98480${String(hash(s.id) % 100000).padStart(5, '0')}` },
      salary: {
        ...structure,
        pfApplicable: true,
        pfOnFullBasic: false,
        tdsMonthlyPaise: (s.tds ?? 0) * 100,
        effectiveFrom: '2026-04-01',
      },
    });
  });

  // Leave: some taken, some waiting — the approvals queue is never empty on day one.
  const leave = (employeeId: string, type: string, from: string, to: string, status: LeaveRequest['status'], reason: string, halfDay: LeaveRequest['halfDay'] = null) => {
    const e = db.employees.find((x) => x.id === employeeId)!;
    db.leaves.push({
      id: nextId(db, 'lv'),
      employeeId,
      type,
      from,
      to,
      halfDay,
      days: leaveDays(from, to, halfDay, db.policy, db.holidays, e.branchCode),
      reason,
      status,
      appliedAt: istMoment(addDays(from, -6), '11:20'),
      decidedBy: status === 'PENDING' ? null : e.managerId,
      decidedAt: status === 'PENDING' ? null : istMoment(addDays(from, -5), '16:05'),
      decisionNote: status === 'REJECTED' ? 'Month-end close that week — can we move it?' : null,
    });
  };
  leave('e-sunita', 'EL', '2026-10-12', '2026-10-16', 'APPROVED', 'Family trip to Goa');
  leave('e-meera', 'SL', '2026-11-05', '2026-11-06', 'APPROVED', 'Viral fever');
  leave('e-rakesh', 'CL', '2026-09-28', '2026-09-28', 'APPROVED', 'Bank work');
  leave('e-suresh', 'LOP', '2026-10-26', '2026-10-27', 'APPROVED', 'Village festival');
  leave('e-kiran', 'CL', '2026-11-16', '2026-11-16', 'APPROVED', 'Personal work', 'SECOND');
  leave('e-deepa', 'EL', '2026-10-28', '2026-10-30', 'REJECTED', 'Cousin’s wedding');
  leave('e-anil', 'EL', '2026-09-21', '2026-09-23', 'APPROVED', 'Short break');
  leave('e-kiran', 'CL', '2026-12-01', '2026-12-02', 'PENDING', 'Sister’s engagement');
  leave('e-lakshmi', 'EL', '2026-12-24', '2026-12-31', 'PENDING', 'Christmas with family in Kerala');
  leave('e-arjun', 'SL', '2026-11-19', '2026-11-19', 'PENDING', 'Fever — doctor’s note attached');
  leave('e-neha', 'CL', '2026-11-27', '2026-11-27', 'PENDING', 'Parent–teacher meeting');
  leave('e-farhan', 'EL', '2026-12-14', '2026-12-18', 'PENDING', 'Hometown visit');

  db.carried = Object.fromEntries(db.employees.map((e) => [e.id, { EL: between(0, 14, e.id, 'carry') }]));

  fillAttendance(db, '2026-10-31');

  // September and October, paid and released.
  for (const month of ['2026-09', '2026-10']) {
    const run = newRun(db, month, 'u-hr');
    run.preparedAt = istMoment(`${shiftMonth(month, 1)}-01`, '15:30');
    run.status = 'RELEASED';
    run.submittedAt = istMoment(`${shiftMonth(month, 1)}-01`, '17:10');
    run.approvedBy = 'u-lead';
    run.approvedAt = istMoment(`${shiftMonth(month, 1)}-02`, '10:30');
    run.releasedAt = istMoment(`${shiftMonth(month, 1)}-02`, '11:00');
    for (const p of db.payslips) if (p.runId === run.id) p.status = 'RELEASED';
  }

  // Two corrections and a bank change waiting.
  db.corrections.push(
    { id: nextId(db, 'cor'), employeeId: 'e-farhan', date: '2026-11-18', checkIn: istMoment('2026-11-18', '09:28'), checkOut: istMoment('2026-11-18', '18:45'), reason: 'Phone battery died — forgot to check out', status: 'PENDING', raisedAt: istMoment('2026-11-19', '09:40'), decidedBy: null, decidedAt: null, decisionNote: null },
    { id: nextId(db, 'cor'), employeeId: 'e-ravi', date: '2026-11-17', checkIn: istMoment('2026-11-17', '07:30'), checkOut: istMoment('2026-11-17', '16:30'), reason: 'Early loading at the port — started at 7:30', status: 'PENDING', raisedAt: istMoment('2026-11-17', '17:05'), decidedBy: null, decidedAt: null, decisionNote: null },
  );
  db.changes.push({
    id: nextId(db, 'chg'),
    employeeId: 'e-deepa',
    field: 'bank',
    before: 'Axis Bank ···· 4120',
    after: 'HDFC Bank ···· 9917',
    bank: { holder: 'Deepa Joshi', bank: 'HDFC Bank', accountNo: '50100299179917', ifsc: 'HDFC0000188' },
    reason: 'Moved my salary account to HDFC',
    status: 'PENDING',
    raisedAt: istMoment('2026-11-20', '12:10'),
    decidedBy: null,
    decidedAt: null,
  });
  return db;
}

/**
 * Sample punches for every working day up to yesterday (and today, for staff
 * without a login). Approved leave and holidays are left alone. Never
 * overwrites a day that already has a record.
 */
function fillAttendance(db: HrDb, until = addDays(today(), -1)): void {
  const t = today();
  const end = until < t ? until : addDays(t, -1);
  const start = addDays(db.filledUntil, 1);
  const have = new Set(db.records.map((r) => `${r.employeeId}|${r.date}`));
  const add = (e: Employee, date: string, partial: boolean) => {
    if (date < e.joinedOn || (e.exitOn && date > e.exitOn) || e.status === 'EXITED') return;
    if (have.has(`${e.id}|${date}`)) return;
    if (isWeeklyOff(date, db.policy) || holidayOn(date, db.holidays, e.branchCode)) return;
    const mine = db.leaves.filter((l) => l.employeeId === e.id);
    const lv = leaveOn(date, mine);
    if (lv && !lv.halfDay) return;
    if (chance(e.id, date, 'absent') < 0.012) return;
    const place = db.places.find((p) => p.code === e.branchCode) ?? db.places[0];
    const spec = SAMPLE.find((s) => s.id === e.id);
    const away = !!spec?.field && chance(e.id, date, 'away') < 0.35;
    const late = chance(e.id, date, 'late') < 0.1;
    const inMin = late ? between(9 * 60 + 46, 10 * 60 + 35, e.id, date, 'in') : between(9 * 60 + 2, 9 * 60 + 42, e.id, date, 'in');
    const half = chance(e.id, date, 'half') < 0.012;
    const outMin = half ? between(13 * 60 + 30, 15 * 60, e.id, date, 'out') : between(18 * 60 + 25, 19 * 60 + 40, e.id, date, 'out');
    const jitter = (k: string) => (chance(e.id, date, k) - 0.5) * (away ? 0.12 : 0.0024);
    const lat = place.lat + jitter('lat');
    const lng = place.lng + jitter('lng');
    const distanceM = metresBetween({ lat, lng }, place);
    const inPlace = { lat, lng, distanceM, withinBranch: distanceM <= db.policy.geofenceMeters, note: distanceM <= db.policy.geofenceMeters ? null : ['Client visit — Steel plant', 'At the port for loading', 'Meeting a transporter'][hash(e.id + date) % 3] };
    const nowMin = istMinutes(nowIso());
    const showOut = !partial || nowMin >= outMin;
    if (partial && nowMin < inMin) return;
    db.records.push({
      employeeId: e.id,
      date,
      checkIn: istMoment(date, hhmm(inMin)),
      checkOut: showOut ? istMoment(date, hhmm(outMin)) : null,
      inPlace,
      outPlace: showOut ? inPlace : null,
      statusOverride: null,
      note: null,
      source: 'APP',
    });
    have.add(`${e.id}|${date}`);
  };
  if (start <= end) {
    for (const date of datesBetween(start, end)) for (const e of db.employees) {
      // People with a login fill in their own days from the day they first use My HR.
      if (e.userId && date >= (firstUse ?? '9999')) continue;
      add(e, date, false);
    }
    db.filledUntil = end;
  }
  // Today, for the sample staff without a login — so the board is alive.
  for (const e of db.employees) if (!e.userId) add(e, t, true);
}

/** The first day anyone opened HR in this browser: from then on, people with a login mark their own days. */
let firstUse: string | null = null;
function noteFirstUse(): void {
  if (firstUse) return;
  try {
    const key = `${STORE_KEY}.first-use`;
    firstUse = storage()?.getItem(key) ?? null;
    if (!firstUse) {
      firstUse = today();
      storage()?.setItem(key, firstUse);
    }
  } catch {
    firstUse = today();
  }
}

/* ---- reading the data --------------------------------------------------- */

const grants = (role: RoleCode): Permission[] => SEED_GRANTS[role] ?? [];
const can = (ctx: HrCtx, p: Permission) => grants(ctx.role).includes(p);
/** The HR desk's screens: HR, Leadership and Administration. */
const seesHrDesk = (ctx: HrCtx) => ['HR', 'LEADERSHIP', 'ADMIN'].includes(ctx.role);

function meOf(db: HrDb, ctx: HrCtx): Employee {
  const me = db.employees.find((e) => e.userId === ctx.userId);
  if (!me) fail(404, 'NO_EMPLOYEE_RECORD', 'HR has not added you to the employee list yet. Ask HR to add you — your login email is how they link you.');
  return me;
}

function employee(db: HrDb, id: string): Employee {
  return db.employees.find((e) => e.id === id) ?? fail(404, 'NOT_FOUND', 'No such employee.');
}

const placeOf = (db: HrDb, code: string) => db.places.find((p) => p.code === code) ?? db.places[0];
const maskPan = (pan: string | null) => (pan ? `${pan.slice(0, 2)}••••••${pan.slice(-2)}` : null);
const maskAccount = (no: string) => `•••• ${no.slice(-4)}`;

function view(db: HrDb, e: Employee, full: boolean): EmployeeView {
  const { salary, ...rest } = e;
  const out: EmployeeView = {
    ...rest,
    branchName: placeOf(db, e.branchCode).name,
    managerName: e.managerId ? db.employees.find((m) => m.id === e.managerId)?.name ?? null : null,
    pan: full ? e.pan : maskPan(e.pan),
    bank: e.bank ? (full ? e.bank : { ...e.bank, accountNo: maskAccount(e.bank.accountNo) }) : null,
    reports: db.employees.filter((x) => x.managerId === e.id && x.status !== 'EXITED').length,
  };
  if (full) {
    out.salary = salary;
    out.monthlyGrossPaise = monthlyGross(salary);
  }
  return out;
}

function daysOf(db: HrDb, e: Employee, dates: string[]): AttendanceDay[] {
  const t = today();
  const now = nowIso();
  const mine = db.leaves.filter((l) => l.employeeId === e.id);
  const recs = new Map(db.records.filter((r) => r.employeeId === e.id).map((r) => [r.date, r]));
  const pendingCorr = new Set(db.corrections.filter((c) => c.employeeId === e.id && c.status === 'PENDING').map((c) => c.date));
  return dates.map((date) =>
    dayFor(recs.get(date), {
      date,
      today: t,
      now,
      joinedOn: e.joinedOn,
      exitOn: e.exitOn,
      policy: db.policy,
      branchCode: e.branchCode,
      holidays: db.holidays,
      leaves: mine,
      correctionPending: pendingCorr.has(date),
    }),
  );
}

const paidLeave = (db: HrDb) => (type: string) => db.policy.leaveTypes.find((t) => t.code === type)?.paid ?? true;

function monthFor(db: HrDb, e: Employee, month: string) {
  const days = daysOf(db, e, datesOfMonth(month));
  const summary = summarise(month, days, db.leaves.filter((l) => l.employeeId === e.id), paidLeave(db));
  return { days, summary };
}

function balancesOf(db: HrDb, e: Employee, year = leaveYearOf(today())) {
  return balances(db.policy.leaveTypes, db.leaves.filter((l) => l.employeeId === e.id), year, db.carried[e.id] ?? {});
}

function upcomingHolidays(db: HrDb, branchCode: string, n = 5): Holiday[] {
  const t = today();
  return db.holidays
    .filter((h) => h.date >= t && (!h.branches || h.branches.includes(branchCode)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, n);
}

const typeName = (db: HrDb, code: string) => db.policy.leaveTypes.find((t) => t.code === code)?.name ?? code;
const span = (from: string, to: string) => (from === to ? dateLabel(from) : `${dateLabel(from)} – ${dateLabel(to)}`);

function pendingFor(db: HrDb, filter: (e: Employee) => boolean): PendingItem[] {
  const items: PendingItem[] = [];
  const who = (id: string) => db.employees.find((e) => e.id === id)!;
  for (const l of db.leaves.filter((x) => x.status === 'PENDING')) {
    const e = who(l.employeeId);
    if (!filter(e)) continue;
    items.push({
      kind: 'LEAVE',
      id: l.id,
      employeeId: e.id,
      employeeName: e.name,
      employeeCode: e.code,
      branchName: placeOf(db, e.branchCode).name,
      title: `${typeName(db, l.type)} · ${l.days} day${l.days === 1 ? '' : 's'}`,
      detail: `${span(l.from, l.to)}${l.halfDay ? (l.halfDay === 'FIRST' ? ' (first half)' : ' (second half)') : ''} — “${l.reason}”`,
      raisedAt: l.appliedAt,
      leave: l,
    });
  }
  for (const c of db.corrections.filter((x) => x.status === 'PENDING')) {
    const e = who(c.employeeId);
    if (!filter(e)) continue;
    items.push({
      kind: 'CORRECTION',
      id: c.id,
      employeeId: e.id,
      employeeName: e.name,
      employeeCode: e.code,
      branchName: placeOf(db, e.branchCode).name,
      title: `Attendance correction · ${dateLabel(c.date)}`,
      detail: `In ${c.checkIn ? istClockShort(c.checkIn) : '—'}, out ${c.checkOut ? istClockShort(c.checkOut) : '—'} — “${c.reason}”`,
      raisedAt: c.raisedAt,
      correction: c,
    });
  }
  return items.sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));
}

function istClockShort(iso: string): string {
  const m = istMinutes(iso);
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** Can this person decide this employee's leave or correction? Their manager can, and whoever holds `leave.approve`. */
function mayDecide(db: HrDb, ctx: HrCtx, employeeId: string): boolean {
  const target = employee(db, employeeId);
  const me = db.employees.find((e) => e.userId === ctx.userId);
  if (me && me.id === target.id) return false;
  if (can(ctx, 'leave.approve')) return true;
  return !!me && target.managerId === me.id;
}

/* ---- payroll ------------------------------------------------------------ */

function payslipFor(db: HrDb, e: Employee, month: string, runId: string): Payslip {
  const { summary } = monthFor(db, e, month);
  // Days before joining or after leaving are not paid either.
  const outside =
    datesOfMonth(month).filter((d) => d < e.joinedOn || (e.exitOn !== null && d > e.exitOn)).length;
  const place = placeOf(db, e.branchCode);
  const pay = computePay({
    month,
    salary: e.salary,
    policy: db.policy,
    state: place.state,
    gender: e.gender,
    daysInMonth: summary.daysInMonth,
    lopDays: summary.lopDays + outside,
  });
  return {
    id: `ps-${month}-${e.id}`,
    runId,
    month,
    employeeId: e.id,
    employee: {
      code: e.code,
      name: e.name,
      designation: e.designation,
      department: e.department,
      branchName: place.name,
      joinedOn: e.joinedOn,
      pan: maskPan(e.pan),
      uan: e.uan,
      esicNo: pay.esiApplies ? e.esicNo : null,
      bankName: e.bank?.bank ?? null,
      accountNo: e.bank ? maskAccount(e.bank.accountNo) : null,
      ifsc: e.bank?.ifsc ?? null,
    },
    days: {
      inMonth: summary.daysInMonth,
      payable: pay.payableDays,
      lop: summary.lopDays + outside,
      present: summary.present + summary.onDuty + summary.halfDays,
      leave: summary.onLeave,
      holidays: summary.holidays,
      weeklyOffs: summary.weeklyOffs,
    },
    earnings: pay.earnings,
    deductions: pay.deductions,
    employer: pay.employer,
    grossPaise: pay.grossPaise,
    deductionsPaise: pay.deductionsPaise,
    netPaise: pay.netPaise,
    status: 'DRAFT',
  };
}

function onRollsIn(e: Employee, month: string): boolean {
  const end = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  return e.joinedOn <= end && (!e.exitOn || e.exitOn >= `${month}-01`);
}

function computeRun(db: HrDb, run: PayrollRun): void {
  db.payslips = db.payslips.filter((p) => p.runId !== run.id);
  const slips = db.employees.filter((e) => onRollsIn(e, run.month)).map((e) => payslipFor(db, e, run.month, run.id));
  db.payslips.push(...slips);
  run.headcount = slips.length;
  run.grossPaise = slips.reduce((a, p) => a + p.grossPaise, 0);
  run.deductionsPaise = slips.reduce((a, p) => a + p.deductionsPaise, 0);
  run.netPaise = slips.reduce((a, p) => a + p.netPaise, 0);
  run.employerCostPaise = run.grossPaise + slips.reduce((a, p) => a + p.employer.reduce((t, l) => t + l.amountPaise, 0), 0);
}

function newRun(db: HrDb, month: string, by: string): PayrollRun {
  const run: PayrollRun = {
    id: `run-${month}`,
    month,
    status: 'DRAFT',
    preparedBy: by,
    preparedAt: nowIso(),
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    releasedAt: null,
    sentBackNote: null,
    headcount: 0,
    grossPaise: 0,
    deductionsPaise: 0,
    netPaise: 0,
    employerCostPaise: 0,
  };
  db.runs.push(run);
  computeRun(db, run);
  return run;
}

function rowsOf(db: HrDb, run: PayrollRun): PayslipRow[] {
  return db.payslips
    .filter((p) => p.runId === run.id)
    .map((p) => {
      const e = employee(db, p.employeeId);
      const flags: string[] = [];
      if (!e.bank) flags.push('No bank account — cannot be paid by transfer');
      if (p.days.lop > 0) flags.push(`${p.days.lop} day${p.days.lop === 1 ? '' : 's'} without pay`);
      if (e.salary.tdsMonthlyPaise > 0 && !e.pan) flags.push('TDS deducted but no PAN on file');
      if (e.salary.pfApplicable && !e.uan) flags.push('PF deducted but no UAN yet');
      if (e.joinedOn.startsWith(run.month)) flags.push(`Joined ${dateLabel(e.joinedOn)}`);
      return {
        id: p.id,
        employeeId: e.id,
        code: e.code,
        name: e.name,
        designation: e.designation,
        branchName: placeOf(db, e.branchCode).name,
        payableDays: p.days.payable,
        lopDays: p.days.lop,
        grossPaise: p.grossPaise,
        deductionsPaise: p.deductionsPaise,
        netPaise: p.netPaise,
        flags,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

const nameOfUser = (db: HrDb, userId: string | null) => (userId ? db.employees.find((e) => e.userId === userId)?.name ?? 'Someone' : null);

function runView(db: HrDb, run: PayrollRun) {
  return { ...run, preparedByName: nameOfUser(db, run.preparedBy), approvedByName: nameOfUser(db, run.approvedBy), label: monthLabel(run.month) };
}

/* ---- check-in ----------------------------------------------------------- */

function punchPlace(db: HrDb, e: Employee, body: any) {
  const lat = typeof body?.lat === 'number' ? body.lat : null;
  const lng = typeof body?.lng === 'number' ? body.lng : null;
  const place = placeOf(db, e.branchCode);
  const distanceM = lat !== null && lng !== null ? metresBetween({ lat, lng }, place) : null;
  const withinBranch = distanceM !== null && distanceM <= db.policy.geofenceMeters;
  const note = String(body?.note ?? '').trim() || null;
  if (!withinBranch && !note) {
    fail(
      400,
      distanceM === null ? 'LOCATION_UNKNOWN' : 'OUTSIDE_BRANCH',
      distanceM === null
        ? 'Your location could not be read. Say where you are working today.'
        : `You are ${distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${distanceM} m`} from ${place.name}. Say where you are working today.`,
      { distanceM, branch: place.name },
    );
  }
  return { lat, lng, distanceM, withinBranch, note: withinBranch ? null : note };
}

/* ---- routes ------------------------------------------------------------- */

const ONLY_HR = (ctx: HrCtx) => {
  if (!seesHrDesk(ctx)) fail(403, 'FORBIDDEN', 'Only HR can see this.');
};
const NEED = (ctx: HrCtx, p: Permission, what: string) => {
  if (!can(ctx, p)) fail(403, 'FORBIDDEN', what);
};

function withDb<T>(fn: (db: HrDb, ctx: HrCtx) => T, write = false): HrHandler {
  return (ctx) => {
    noteFirstUse();
    const db = load();
    const out = fn(db, ctx);
    if (write) save();
    return out;
  };
}

export const hrRoutes: [string, RegExp, HrHandler][] = [
  /* ---- My HR ---- */
  [
    'GET',
    /^\/me\/hr$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const t = today();
      const month = monthOf(t);
      const { days, summary } = monthFor(db, me, month);
      const reports = db.employees.filter((e) => e.managerId === me.id && e.status !== 'EXITED');
      const latest = db.payslips
        .filter((p) => p.employeeId === me.id && p.status === 'RELEASED')
        .sort((a, b) => b.month.localeCompare(a.month))[0];
      const myPending = pendingFor(db, (e) => e.id === me.id);
      const teamPending = reports.length ? pendingFor(db, (e) => e.managerId === me.id) : [];
      const teamToday = reports.length ? reports.map((r) => ({ id: r.id, name: r.name, designation: r.designation, day: daysOf(db, r, [t])[0] })) : [];
      return {
        employee: view(db, me, true),
        today: days.find((d) => d.date === t) ?? daysOf(db, me, [t])[0],
        branch: placeOf(db, me.branchCode),
        policy: { shiftStart: db.policy.shiftStart, shiftEnd: db.policy.shiftEnd, graceMinutes: db.policy.graceMinutes, geofenceMeters: db.policy.geofenceMeters, fullDayMinutes: db.policy.fullDayMinutes },
        month: summary,
        week: daysOf(db, me, datesBetween(addDays(t, -6), t)),
        balances: balancesOf(db, me),
        holidays: upcomingHolidays(db, me.branchCode, 4),
        myPending,
        latestPayslip: latest ? { id: latest.id, month: latest.month, netPaise: latest.netPaise, grossPaise: latest.grossPaise, deductionsPaise: latest.deductionsPaise } : null,
        team: reports.length ? { size: reports.length, today: teamToday, pending: teamPending } : null,
      };
    }),
  ],
  [
    'POST',
    /^\/me\/attendance\/check-in$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const t = today();
      const existing = db.records.find((r) => r.employeeId === me.id && r.date === t);
      if (existing?.checkIn) fail(409, 'ALREADY_IN', 'You have already checked in today.');
      const inPlace = punchPlace(db, me, ctx.body);
      const rec: AttendanceRecord = existing ?? { employeeId: me.id, date: t, checkIn: null, checkOut: null, inPlace: null, outPlace: null, statusOverride: null, note: null, source: 'APP' };
      rec.checkIn = nowIso();
      rec.inPlace = inPlace;
      if (!existing) db.records.push(rec);
      return daysOf(db, me, [t])[0];
    }, true),
  ],
  [
    'POST',
    /^\/me\/attendance\/check-out$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const t = today();
      const rec = db.records.find((r) => r.employeeId === me.id && r.date === t);
      if (!rec?.checkIn) fail(409, 'NOT_IN', 'Check in first — there is nothing to check out of.');
      if (rec.checkOut) fail(409, 'ALREADY_OUT', 'You have already checked out today. If the time is wrong, raise a correction.');
      const place = placeOf(db, me.branchCode);
      const lat = typeof ctx.body?.lat === 'number' ? ctx.body.lat : null;
      const lng = typeof ctx.body?.lng === 'number' ? ctx.body.lng : null;
      const distanceM = lat !== null && lng !== null ? metresBetween({ lat, lng }, place) : null;
      rec.checkOut = nowIso();
      rec.outPlace = { lat, lng, distanceM, withinBranch: distanceM !== null && distanceM <= db.policy.geofenceMeters, note: String(ctx.body?.note ?? '').trim() || null };
      return daysOf(db, me, [t])[0];
    }, true),
  ],
  [
    'GET',
    /^\/me\/attendance$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const month = ctx.query.get('month') || monthOf(today());
      const { days, summary } = monthFor(db, me, month);
      return { month, days, summary, corrections: db.corrections.filter((c) => c.employeeId === me.id).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)), joinedOn: me.joinedOn };
    }),
  ],
  [
    'POST',
    /^\/me\/corrections$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const { date, checkIn, checkOut, reason } = ctx.body ?? {};
      if (!date || date > today()) fail(400, 'BAD_DATE', 'Choose a day that has already started.');
      if (date < me.joinedOn) fail(400, 'BAD_DATE', 'That is before you joined.');
      if (!checkIn && !checkOut) fail(400, 'NOTHING_TO_FIX', 'Give the check-in time, the check-out time, or both.');
      if (String(reason ?? '').trim().length < 5) fail(400, 'REASON_NEEDED', 'Say what happened — a short sentence is enough.');
      if (checkIn && checkOut && istMoment(date, checkOut) <= istMoment(date, checkIn)) fail(400, 'BAD_TIMES', 'Check-out has to be after check-in.');
      if (db.corrections.some((c) => c.employeeId === me.id && c.date === date && c.status === 'PENDING'))
        fail(409, 'ALREADY_ASKED', 'A correction for that day is already waiting for approval.');
      const c: Correction = {
        id: nextId(db, 'cor'),
        employeeId: me.id,
        date,
        checkIn: checkIn ? istMoment(date, checkIn) : null,
        checkOut: checkOut ? istMoment(date, checkOut) : null,
        reason: String(reason).trim(),
        status: 'PENDING',
        raisedAt: nowIso(),
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
      };
      db.corrections.push(c);
      return c;
    }, true),
  ],
  [
    'GET',
    /^\/me\/leave$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      return {
        balances: balancesOf(db, me),
        requests: db.leaves.filter((l) => l.employeeId === me.id).sort((a, b) => b.from.localeCompare(a.from)),
        types: db.policy.leaveTypes,
        holidays: db.holidays.filter((h) => h.date >= `${leaveYearOf(today())}-01-01`).sort((a, b) => a.date.localeCompare(b.date)),
        approverName: me.managerId ? employee(db, me.managerId).name : 'HR',
        policy: { weeklyOffs: db.policy.weeklyOffs, alternateSaturdaysOff: db.policy.alternateSaturdaysOff },
        branchCode: me.branchCode,
        today: today(),
      };
    }),
  ],
  [
    'GET',
    /^\/me\/leave\/days$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const from = ctx.query.get('from') ?? '';
      const to = ctx.query.get('to') ?? from;
      const half = (ctx.query.get('half') || null) as LeaveRequest['halfDay'];
      return { days: from && to ? leaveDays(from, to, half, db.policy, db.holidays, me.branchCode) : 0 };
    }),
  ],
  [
    'POST',
    /^\/me\/leave$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const ask = {
        type: String(ctx.body?.type ?? ''),
        from: String(ctx.body?.from ?? ''),
        to: String(ctx.body?.to ?? ctx.body?.from ?? ''),
        halfDay: (ctx.body?.halfDay ?? null) as LeaveRequest['halfDay'],
        reason: String(ctx.body?.reason ?? ''),
      };
      const type = db.policy.leaveTypes.find((t) => t.code === ask.type);
      const days = ask.from && ask.to ? leaveDays(ask.from, ask.to, ask.halfDay, db.policy, db.holidays, me.branchCode) : 0;
      const balance = balancesOf(db, me, leaveYearOf(ask.from || today())).find((b) => b.code === ask.type);
      const problem = leaveProblem(ask, { today: today(), type, days, balance, existing: db.leaves.filter((l) => l.employeeId === me.id) });
      if (problem) fail(400, 'LEAVE_REFUSED', problem);
      const req: LeaveRequest = { id: nextId(db, 'lv'), employeeId: me.id, ...ask, reason: ask.reason.trim(), days, status: 'PENDING', appliedAt: nowIso(), decidedBy: null, decidedAt: null, decisionNote: null };
      db.leaves.push(req);
      return req;
    }, true),
  ],
  [
    'POST',
    /^\/me\/leave\/([^/]+)\/cancel$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const l = db.leaves.find((x) => x.id === ctx.params[0] && x.employeeId === me.id) ?? fail(404, 'NOT_FOUND', 'No such leave request.');
      if (l.status === 'CANCELLED' || l.status === 'REJECTED') fail(409, 'CLOSED', 'That request is already closed.');
      if (l.status === 'APPROVED' && l.from <= today()) fail(409, 'STARTED', 'This leave has already started. Ask HR to change it.');
      l.status = 'CANCELLED';
      return l;
    }, true),
  ],
  [
    'GET',
    /^\/me\/payslips$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      return db.payslips
        .filter((p) => p.employeeId === me.id && p.status === 'RELEASED')
        .sort((a, b) => b.month.localeCompare(a.month))
        .map((p) => ({ id: p.id, month: p.month, label: monthLabel(p.month), grossPaise: p.grossPaise, deductionsPaise: p.deductionsPaise, netPaise: p.netPaise, payableDays: p.days.payable, lopDays: p.days.lop }));
    }),
  ],
  [
    'GET',
    /^\/payslips\/([^/]+)$/,
    withDb((db, ctx) => {
      const p = db.payslips.find((x) => x.id === ctx.params[0]) ?? fail(404, 'NOT_FOUND', 'No such payslip.');
      const me = db.employees.find((e) => e.userId === ctx.userId);
      const own = me?.id === p.employeeId;
      if (own && p.status !== 'RELEASED') fail(404, 'NOT_FOUND', 'This payslip has not been released yet.');
      if (!own && !(can(ctx, 'payroll.run') || can(ctx, 'payroll.approve'))) fail(403, 'FORBIDDEN', 'Only the person, and payroll, can open a payslip.');
      return { ...p, label: monthLabel(p.month) };
    }),
  ],
  [
    'GET',
    /^\/me\/profile$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const t = today();
      return {
        employee: view(db, me, true),
        changes: db.changes.filter((c) => c.employeeId === me.id).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)),
        yearsWithUs: yearsBetween(me.joinedOn, t),
        branch: placeOf(db, me.branchCode),
      };
    }),
  ],
  [
    'PATCH',
    /^\/me\/profile$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const b = ctx.body ?? {};
      if (b.phone !== undefined) {
        if (!/^[6-9]\d{9}$/.test(String(b.phone))) fail(400, 'BAD_PHONE', 'A 10-digit mobile number, please.');
        me.phone = String(b.phone);
      }
      if (b.address !== undefined) me.address = String(b.address).trim() || null;
      if (b.emergency !== undefined) {
        const em = b.emergency;
        if (em && (!em.name?.trim() || !/^[6-9]\d{9}$/.test(String(em.phone ?? '')))) fail(400, 'BAD_CONTACT', 'Give the emergency contact’s name and a 10-digit mobile number.');
        me.emergency = em ? { name: em.name.trim(), relation: String(em.relation ?? '').trim(), phone: String(em.phone) } : null;
      }
      return view(db, me, true);
    }, true),
  ],
  [
    'POST',
    /^\/me\/profile\/changes$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const b = ctx.body ?? {};
      if (db.changes.some((c) => c.employeeId === me.id && c.field === b.field && c.status === 'PENDING'))
        fail(409, 'ALREADY_ASKED', 'A change to this is already waiting for HR.');
      if (b.field === 'bank') {
        const bank = b.bank as BankAccount;
        if (!bank?.bank?.trim() || !/^\d{9,18}$/.test(String(bank.accountNo ?? '')) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(bank.ifsc ?? '').toUpperCase()))
          fail(400, 'BAD_BANK', 'Give the bank, a 9–18 digit account number and the 11-character IFSC.');
        const c: ProfileChange = {
          id: nextId(db, 'chg'),
          employeeId: me.id,
          field: 'bank',
          before: me.bank ? `${me.bank.bank} ${maskAccount(me.bank.accountNo)}` : null,
          after: `${bank.bank.trim()} ${maskAccount(bank.accountNo)}`,
          bank: { holder: bank.holder?.trim() || me.name, bank: bank.bank.trim(), accountNo: String(bank.accountNo), ifsc: String(bank.ifsc).toUpperCase() },
          reason: String(b.reason ?? '').trim() || 'New salary account',
          status: 'PENDING',
          raisedAt: nowIso(),
          decidedBy: null,
          decidedAt: null,
        };
        db.changes.push(c);
        return c;
      }
      if (b.field === 'pan') {
        const pan = String(b.pan ?? '').toUpperCase();
        if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) fail(400, 'BAD_PAN', 'A PAN is 10 characters: 5 letters, 4 digits, 1 letter.');
        const c: ProfileChange = { id: nextId(db, 'chg'), employeeId: me.id, field: 'pan', before: maskPan(me.pan), after: pan, reason: String(b.reason ?? '').trim() || 'PAN update', status: 'PENDING', raisedAt: nowIso(), decidedBy: null, decidedAt: null };
        db.changes.push(c);
        return c;
      }
      fail(400, 'BAD_FIELD', 'Only the bank account and PAN go through HR.');
    }, true),
  ],

  /* ---- decisions (managers and HR) ---- */
  [
    'POST',
    /^\/hr\/leave\/([^/]+)\/decide$/,
    withDb((db, ctx) => {
      const l = db.leaves.find((x) => x.id === ctx.params[0]) ?? fail(404, 'NOT_FOUND', 'No such leave request.');
      if (!mayDecide(db, ctx, l.employeeId)) fail(403, 'FORBIDDEN', 'Only their manager or HR decides this — and nobody decides their own.');
      if (l.status !== 'PENDING') fail(409, 'DECIDED', 'This request has already been decided.');
      const approve = ctx.body?.decision === 'APPROVE';
      if (!approve && String(ctx.body?.note ?? '').trim().length < 3) fail(400, 'NOTE_NEEDED', 'Say why, so they can plan around it.');
      l.status = approve ? 'APPROVED' : 'REJECTED';
      l.decidedBy = db.employees.find((e) => e.userId === ctx.userId)?.id ?? ctx.userId;
      l.decidedAt = nowIso();
      l.decisionNote = String(ctx.body?.note ?? '').trim() || null;
      return l;
    }, true),
  ],
  [
    'POST',
    /^\/hr\/corrections\/([^/]+)\/decide$/,
    withDb((db, ctx) => {
      const c = db.corrections.find((x) => x.id === ctx.params[0]) ?? fail(404, 'NOT_FOUND', 'No such correction.');
      if (!mayDecide(db, ctx, c.employeeId)) fail(403, 'FORBIDDEN', 'Only their manager or HR decides this — and nobody decides their own.');
      if (c.status !== 'PENDING') fail(409, 'DECIDED', 'This correction has already been decided.');
      const approve = ctx.body?.decision === 'APPROVE';
      c.status = approve ? 'APPROVED' : 'REJECTED';
      c.decidedBy = db.employees.find((e) => e.userId === ctx.userId)?.id ?? ctx.userId;
      c.decidedAt = nowIso();
      c.decisionNote = String(ctx.body?.note ?? '').trim() || null;
      if (approve) {
        let rec = db.records.find((r) => r.employeeId === c.employeeId && r.date === c.date);
        if (!rec) {
          rec = { employeeId: c.employeeId, date: c.date, checkIn: null, checkOut: null, inPlace: null, outPlace: null, statusOverride: null, note: null, source: 'CORRECTION' };
          db.records.push(rec);
        }
        if (c.checkIn) rec.checkIn = c.checkIn;
        if (c.checkOut) rec.checkOut = c.checkOut;
        rec.source = 'CORRECTION';
        rec.note = `Corrected: ${c.reason}`;
      }
      return c;
    }, true),
  ],

  /* ---- the HR desk ---- */
  [
    'GET',
    /^\/hr\/overview$/,
    withDb((db, ctx) => {
      ONLY_HR(ctx);
      const t = today();
      const active = db.employees.filter((e) => e.status !== 'EXITED' && e.joinedOn <= t);
      const todays = active.map((e) => ({ e, day: daysOf(db, e, [t])[0] }));
      const by = (s: string[]) => todays.filter((x) => s.includes(x.day.status));
      const trend = [] as { date: string; present: number; total: number }[];
      for (let d = addDays(t, -1); trend.length < 14 && d > addDays(t, -40); d = addDays(d, -1)) {
        if (isWeeklyOff(d, db.policy) || holidayOn(d, db.holidays, 'VZG')) continue;
        const onRolls = active.filter((e) => e.joinedOn <= d);
        const present = onRolls.filter((e) => ['PRESENT', 'LATE', 'ON_DUTY', 'HALF_DAY'].includes(daysOf(db, e, [d])[0].status)).length;
        trend.unshift({ date: d, present, total: onRolls.length });
      }
      const month = monthOf(t);
      const run = db.runs.find((r) => r.month === month);
      const lastRun = [...db.runs].sort((a, b) => b.month.localeCompare(a.month))[0];
      const celebrations: { name: string; kind: 'BIRTHDAY' | 'ANNIVERSARY'; date: string; years: number; designation: string }[] = [];
      for (let i = 0; i <= 30; i++) {
        const d = addDays(t, i);
        for (const e of active) {
          if (e.dob && e.dob.slice(5) === d.slice(5)) celebrations.push({ name: e.name, kind: 'BIRTHDAY', date: d, years: yearsBetween(e.dob, d), designation: e.designation });
          if (e.joinedOn.slice(5) === d.slice(5) && e.joinedOn < d) celebrations.push({ name: e.name, kind: 'ANNIVERSARY', date: d, years: yearsBetween(e.joinedOn, d), designation: e.designation });
        }
      }
      return {
        date: t,
        headcount: active.length,
        status: {
          in: by(['PRESENT', 'LATE', 'HALF_DAY']).length,
          late: by(['LATE']).length,
          onDuty: by(['ON_DUTY']).length,
          onLeave: by(['ON_LEAVE']).length,
          notYet: by(['NOT_YET']).length,
          absent: by(['ABSENT']).length,
          off: by(['HOLIDAY', 'WEEKLY_OFF']).length,
        },
        // The head office calendar decides whether today is a working day at all.
        dayOff: holidayOn(t, db.holidays, 'VZG')?.name ?? (isWeeklyOff(t, db.policy) ? 'Weekly off' : null),
        branches: db.places
          .map((p) => {
            const here = todays.filter((x) => x.e.branchCode === p.code);
            return { code: p.code, name: p.name, total: here.length, in: here.filter((x) => ['PRESENT', 'LATE', 'HALF_DAY', 'ON_DUTY'].includes(x.day.status)).length };
          })
          .filter((b) => b.total > 0),
        departments: [...new Set(active.map((e) => e.department))].map((d) => ({ name: d, count: active.filter((e) => e.department === d).length })).sort((a, b) => b.count - a.count),
        trend,
        pending: pendingFor(db, () => true),
        changes: db.changes.filter((c) => c.status === 'PENDING').map((c) => ({ ...c, employeeName: employee(db, c.employeeId).name })),
        onLeaveToday: by(['ON_LEAVE']).map((x) => {
          const l = leaveOn(t, db.leaves.filter((y) => y.employeeId === x.e.id));
          return { id: x.e.id, name: x.e.name, designation: x.e.designation, type: l ? typeName(db, l.type) : 'Leave', until: l?.to ?? t };
        }),
        notIn: todays
          .filter((x) => ['NOT_YET', 'ABSENT'].includes(x.day.status))
          .map((x) => ({ id: x.e.id, name: x.e.name, designation: x.e.designation, branchName: placeOf(db, x.e.branchCode).name, phone: x.e.phone })),
        celebrations: celebrations.slice(0, 6),
        payroll: {
          month,
          label: monthLabel(month),
          run: run ? runView(db, run) : null,
          last: lastRun ? runView(db, lastRun) : null,
        },
        upcomingHolidays: upcomingHolidays(db, 'VZG', 3),
        newJoiners: active.filter((e) => e.joinedOn >= addDays(t, -60)).map((e) => ({ id: e.id, name: e.name, designation: e.designation, joinedOn: e.joinedOn })),
      };
    }),
  ],
  [
    'GET',
    /^\/hr\/employees$/,
    withDb((db, ctx) => {
      ONLY_HR(ctx);
      const q = (ctx.query.get('q') ?? '').trim().toLowerCase();
      const t = today();
      return db.employees
        .filter((e) => !q || [e.name, e.code, e.designation, e.department, e.phone, e.email ?? ''].some((v) => v.toLowerCase().includes(q)))
        .map((e) => ({ ...view(db, e, true), today: daysOf(db, e, [t])[0].status }))
        .sort((a, b) => a.code.localeCompare(b.code));
    }),
  ],
  [
    'POST',
    /^\/hr\/employees$/,
    withDb((db, ctx) => {
      NEED(ctx, 'hr.manage', 'Only HR adds employees.');
      const b = ctx.body ?? {};
      if (String(b.name ?? '').trim().length < 2) fail(400, 'NAME_NEEDED', 'Give the person’s full name.');
      if (!/^[6-9]\d{9}$/.test(String(b.phone ?? ''))) fail(400, 'BAD_PHONE', 'A 10-digit mobile number, please.');
      if (!b.joinedOn) fail(400, 'JOIN_DATE_NEEDED', 'When do they join?');
      if (!db.places.some((p) => p.code === b.branchCode)) fail(400, 'BAD_BRANCH', 'Choose their branch.');
      const gross = Math.round(Number(b.monthlyGrossRupees ?? 0) * 100);
      if (!(gross > 0)) fail(400, 'SALARY_NEEDED', 'Give their monthly gross salary.');
      if (b.email && db.employees.some((e) => e.email?.toLowerCase() === String(b.email).toLowerCase())) fail(409, 'DUPLICATE_EMAIL', 'Someone already has that email.');
      const n = db.employees.length + 1;
      const e: Employee = {
        id: nextId(db, 'emp'),
        code: `NX-${String(n).padStart(4, '0')}`,
        userId: null,
        name: String(b.name).trim(),
        email: String(b.email ?? '').trim() || null,
        phone: String(b.phone),
        designation: String(b.designation ?? '').trim() || 'Staff',
        department: String(b.department ?? '').trim() || 'Operations',
        branchCode: b.branchCode,
        managerId: b.managerId || null,
        joinedOn: b.joinedOn,
        dob: b.dob || null,
        gender: b.gender || null,
        employmentType: b.employmentType || 'FULL_TIME',
        status: 'ACTIVE',
        exitOn: null,
        pan: String(b.pan ?? '').toUpperCase() || null,
        uan: String(b.uan ?? '') || null,
        esicNo: null,
        address: String(b.address ?? '').trim() || null,
        bank: b.bank?.accountNo ? { holder: String(b.name).trim(), bank: b.bank.bank, accountNo: String(b.bank.accountNo), ifsc: String(b.bank.ifsc).toUpperCase() } : null,
        emergency: null,
        salary: { ...suggestStructure(gross), pfApplicable: b.pfApplicable !== false, pfOnFullBasic: false, tdsMonthlyPaise: Math.round(Number(b.tdsMonthlyRupees ?? 0) * 100), effectiveFrom: b.joinedOn },
      };
      // A console login with the same email is the same person — unless that login is already somebody.
      if (e.email) {
        const login = ACCOUNTS.find((a) => a.email.toLowerCase() === e.email!.toLowerCase());
        if (login && !db.employees.some((x) => x.userId === login.userId)) e.userId = login.userId;
      }
      db.employees.push(e);
      return view(db, e, true);
    }, true),
  ],
  [
    'GET',
    /^\/hr\/employees\/([^/]+)$/,
    withDb((db, ctx) => {
      ONLY_HR(ctx);
      const e = employee(db, ctx.params[0]);
      const month = ctx.query.get('month') || monthOf(today());
      const { days, summary } = monthFor(db, e, month);
      return {
        employee: view(db, e, true),
        month,
        days,
        summary,
        balances: balancesOf(db, e),
        leaves: db.leaves.filter((l) => l.employeeId === e.id).sort((a, b) => b.from.localeCompare(a.from)),
        payslips: db.payslips.filter((p) => p.employeeId === e.id).sort((a, b) => b.month.localeCompare(a.month)).map((p) => ({ id: p.id, month: p.month, label: monthLabel(p.month), netPaise: p.netPaise, grossPaise: p.grossPaise, status: p.status })),
        reports: db.employees.filter((x) => x.managerId === e.id).map((x) => ({ id: x.id, name: x.name, designation: x.designation })),
        changes: db.changes.filter((c) => c.employeeId === e.id),
      };
    }),
  ],
  [
    'PATCH',
    /^\/hr\/employees\/([^/]+)$/,
    withDb((db, ctx) => {
      NEED(ctx, 'hr.manage', 'Only HR changes employee records.');
      const e = employee(db, ctx.params[0]);
      const b = ctx.body ?? {};
      const text = ['name', 'designation', 'department', 'address', 'uan', 'esicNo'] as const;
      for (const k of text) if (b[k] !== undefined) (e as any)[k] = String(b[k]).trim() || (k === 'name' ? e.name : null);
      if (b.email !== undefined) e.email = String(b.email).trim() || null;
      if (b.phone !== undefined) {
        if (!/^[6-9]\d{9}$/.test(String(b.phone))) fail(400, 'BAD_PHONE', 'A 10-digit mobile number, please.');
        e.phone = String(b.phone);
      }
      if (b.pan !== undefined) e.pan = String(b.pan).toUpperCase() || null;
      if (b.branchCode !== undefined) {
        if (!db.places.some((p) => p.code === b.branchCode)) fail(400, 'BAD_BRANCH', 'No such branch.');
        e.branchCode = b.branchCode;
      }
      if (b.managerId !== undefined) {
        if (b.managerId === e.id) fail(400, 'SELF_MANAGER', 'Nobody reports to themselves.');
        e.managerId = b.managerId || null;
      }
      for (const k of ['joinedOn', 'dob', 'gender', 'employmentType'] as const) if (b[k] !== undefined) (e as any)[k] = b[k] || null;
      if (b.bank !== undefined) e.bank = b.bank?.accountNo ? { holder: b.bank.holder || e.name, bank: b.bank.bank, accountNo: String(b.bank.accountNo), ifsc: String(b.bank.ifsc).toUpperCase() } : null;
      if (b.status !== undefined) {
        if (!['ACTIVE', 'ON_NOTICE', 'EXITED'].includes(b.status)) fail(400, 'BAD_STATUS', 'Unknown status.');
        if (b.status !== 'ACTIVE' && !b.exitOn && !e.exitOn) fail(400, 'EXIT_DATE_NEEDED', 'Give the last working day.');
        e.status = b.status;
        e.exitOn = b.status === 'ACTIVE' ? null : b.exitOn ?? e.exitOn;
      }
      if (b.salary) {
        NEED(ctx, 'payroll.run', 'Only payroll changes salaries.');
        const s = b.salary;
        const r = (v: unknown) => Math.max(0, Math.round(Number(v ?? 0) * 100));
        e.salary = {
          basicPaise: r(s.basicRupees),
          hraPaise: r(s.hraRupees),
          conveyancePaise: r(s.conveyanceRupees),
          specialPaise: r(s.specialRupees),
          pfApplicable: !!s.pfApplicable,
          pfOnFullBasic: !!s.pfOnFullBasic,
          tdsMonthlyPaise: r(s.tdsRupees),
          effectiveFrom: s.effectiveFrom || today(),
        };
        if (monthlyGross(e.salary) <= 0) fail(400, 'SALARY_NEEDED', 'The salary adds up to nothing.');
      }
      return view(db, e, true);
    }, true),
  ],
  [
    'GET',
    /^\/hr\/attendance$/,
    withDb((db, ctx) => {
      ONLY_HR(ctx);
      const date = ctx.query.get('date') || today();
      const branch = ctx.query.get('branch') || '';
      const rows = db.employees
        .filter((e) => e.status !== 'EXITED' && e.joinedOn <= date && (!branch || e.branchCode === branch))
        .map((e) => ({ id: e.id, code: e.code, name: e.name, designation: e.designation, branchName: placeOf(db, e.branchCode).name, phone: e.phone, day: daysOf(db, e, [date])[0] }));
      return { date, rows, branches: db.places.map((p) => ({ code: p.code, name: p.name })) };
    }),
  ],
  [
    'GET',
    /^\/hr\/attendance\/register$/,
    withDb((db, ctx) => {
      ONLY_HR(ctx);
      const month = ctx.query.get('month') || monthOf(today());
      const branch = ctx.query.get('branch') || '';
      const rows = db.employees
        .filter((e) => onRollsIn(e, month) && (!branch || e.branchCode === branch))
        .map((e) => {
          const { days, summary } = monthFor(db, e, month);
          return { id: e.id, code: e.code, name: e.name, designation: e.designation, days: days.map((d) => ({ date: d.date, status: d.status, checkIn: d.checkIn, checkOut: d.checkOut })), summary };
        });
      return { month, dates: datesOfMonth(month), rows };
    }),
  ],
  [
    'PUT',
    /^\/hr\/attendance\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/,
    withDb((db, ctx) => {
      NEED(ctx, 'hr.manage', 'Only HR changes attendance.');
      const e = employee(db, ctx.params[0]);
      const date = ctx.params[1];
      if (date > today()) fail(400, 'FUTURE', 'That day has not happened yet.');
      const b = ctx.body ?? {};
      if (String(b.note ?? '').trim().length < 3) fail(400, 'NOTE_NEEDED', 'Say why the day is being changed — it is kept with the record.');
      let rec = db.records.find((r) => r.employeeId === e.id && r.date === date);
      if (!rec) {
        rec = { employeeId: e.id, date, checkIn: null, checkOut: null, inPlace: null, outPlace: null, statusOverride: null, note: null, source: 'HR' };
        db.records.push(rec);
      }
      if (b.checkIn !== undefined) rec.checkIn = b.checkIn ? istMoment(date, b.checkIn) : null;
      if (b.checkOut !== undefined) rec.checkOut = b.checkOut ? istMoment(date, b.checkOut) : null;
      rec.statusOverride = b.status || null;
      rec.note = String(b.note).trim();
      rec.source = 'HR';
      return daysOf(db, e, [date])[0];
    }, true),
  ],
  [
    'GET',
    /^\/hr\/approvals$/,
    withDb((db, ctx) => {
      ONLY_HR(ctx);
      return {
        pending: pendingFor(db, () => true),
        changes: db.changes.filter((c) => c.status === 'PENDING').map((c) => ({ ...c, employeeName: employee(db, c.employeeId).name, employeeCode: employee(db, c.employeeId).code })),
      };
    }),
  ],
  [
    'GET',
    /^\/hr\/leave$/,
    withDb((db, ctx) => {
      ONLY_HR(ctx);
      const month = ctx.query.get('month') || monthOf(today());
      const dates = datesOfMonth(month);
      const start = dates[0];
      const end = dates[dates.length - 1];
      const inMonth = db.leaves.filter((l) => l.from <= end && l.to >= start && (l.status === 'APPROVED' || l.status === 'PENDING'));
      return {
        month,
        dates,
        pending: pendingFor(db, () => true).filter((p) => p.kind === 'LEAVE'),
        calendar: inMonth.map((l) => {
          const e = employee(db, l.employeeId);
          return { ...l, employeeName: e.name, typeName: typeName(db, l.type), hue: db.policy.leaveTypes.find((t) => t.code === l.type)?.hue ?? '#888' };
        }),
        recent: db.leaves
          .filter((l) => l.status !== 'PENDING')
          .sort((a, b) => (b.decidedAt ?? b.appliedAt).localeCompare(a.decidedAt ?? a.appliedAt))
          .slice(0, 25)
          .map((l) => ({ ...l, employeeName: employee(db, l.employeeId).name, typeName: typeName(db, l.type), decidedByName: l.decidedBy ? db.employees.find((e) => e.id === l.decidedBy)?.name ?? null : null })),
        balances: db.employees
          .filter((e) => e.status !== 'EXITED')
          .map((e) => ({ id: e.id, name: e.name, code: e.code, balances: balancesOf(db, e) })),
        types: db.policy.leaveTypes,
      };
    }),
  ],
  [
    'POST',
    /^\/hr\/profile-changes\/([^/]+)\/decide$/,
    withDb((db, ctx) => {
      NEED(ctx, 'hr.manage', 'Only HR confirms bank and PAN changes.');
      const c = db.changes.find((x) => x.id === ctx.params[0]) ?? fail(404, 'NOT_FOUND', 'No such change.');
      if (c.status !== 'PENDING') fail(409, 'DECIDED', 'Already decided.');
      const e = employee(db, c.employeeId);
      const approve = ctx.body?.decision === 'APPROVE';
      c.status = approve ? 'APPROVED' : 'REJECTED';
      c.decidedBy = db.employees.find((x) => x.userId === ctx.userId)?.id ?? ctx.userId;
      c.decidedAt = nowIso();
      if (approve) {
        if (c.field === 'bank' && c.bank) e.bank = c.bank;
        if (c.field === 'pan') e.pan = c.after;
      }
      return c;
    }, true),
  ],
  [
    'GET',
    /^\/hr\/payroll$/,
    withDb((db, ctx) => {
      ONLY_HR(ctx);
      const current = monthOf(today());
      const months = [0, -1, -2].map((n) => shiftMonth(current, n)).filter((m) => !db.runs.some((r) => r.month === m));
      return {
        runs: [...db.runs].sort((a, b) => b.month.localeCompare(a.month)).map((r) => runView(db, r)),
        canPrepare: can(ctx, 'payroll.run'),
        canApprove: can(ctx, 'payroll.approve'),
        openMonths: months.map((m) => ({ month: m, label: monthLabel(m), inProgress: m === current })),
      };
    }),
  ],
  [
    'POST',
    /^\/hr\/payroll$/,
    withDb((db, ctx) => {
      NEED(ctx, 'payroll.run', 'Only HR prepares payroll.');
      const month = String(ctx.body?.month ?? '');
      if (!/^\d{4}-\d{2}$/.test(month)) fail(400, 'BAD_MONTH', 'Choose a month.');
      if (month > monthOf(today())) fail(400, 'FUTURE', 'That month has not started yet.');
      if (db.runs.some((r) => r.month === month)) fail(409, 'EXISTS', `${monthLabel(month)} already has a payroll.`);
      return runView(db, newRun(db, month, ctx.userId));
    }, true),
  ],
  [
    'GET',
    /^\/hr\/payroll\/([^/]+)$/,
    withDb((db, ctx) => {
      ONLY_HR(ctx);
      const run = db.runs.find((r) => r.id === ctx.params[0]) ?? fail(404, 'NOT_FOUND', 'No such payroll.');
      const rows = rowsOf(db, run);
      const preparedByMe = run.preparedBy === ctx.userId;
      return {
        run: runView(db, run),
        rows,
        canPrepare: can(ctx, 'payroll.run'),
        canApprove: can(ctx, 'payroll.approve') && !preparedByMe,
        preparedByMe,
        unbanked: rows.filter((r) => r.flags.some((f) => f.startsWith('No bank'))).length,
        inProgress: run.month === monthOf(today()),
        statutory: {
          pf: db.payslips.filter((p) => p.runId === run.id).reduce((a, p) => a + (p.deductions.find((d) => d.code === 'PF')?.amountPaise ?? 0) + p.employer.filter((x) => x.code.startsWith('EP')).reduce((t, x) => t + x.amountPaise, 0), 0),
          esi: db.payslips.filter((p) => p.runId === run.id).reduce((a, p) => a + (p.deductions.find((d) => d.code === 'ESI')?.amountPaise ?? 0) + (p.employer.find((x) => x.code === 'ESI_ER')?.amountPaise ?? 0), 0),
          pt: db.payslips.filter((p) => p.runId === run.id).reduce((a, p) => a + (p.deductions.find((d) => d.code === 'PT')?.amountPaise ?? 0), 0),
          tds: db.payslips.filter((p) => p.runId === run.id).reduce((a, p) => a + (p.deductions.find((d) => d.code === 'TDS')?.amountPaise ?? 0), 0),
        },
      };
    }),
  ],
  [
    'POST',
    /^\/hr\/payroll\/([^/]+)\/(recalculate|submit|approve|send-back|release)$/,
    withDb((db, ctx) => {
      const run = db.runs.find((r) => r.id === ctx.params[0]) ?? fail(404, 'NOT_FOUND', 'No such payroll.');
      const step = ctx.params[1];
      const at = nowIso();
      if (step === 'recalculate') {
        NEED(ctx, 'payroll.run', 'Only HR prepares payroll.');
        if (run.status !== 'DRAFT') fail(409, 'LOCKED', 'Only a draft can be recalculated. Ask for it to be sent back first.');
        computeRun(db, run);
        run.preparedAt = at;
        run.preparedBy = ctx.userId;
      } else if (step === 'submit') {
        NEED(ctx, 'payroll.run', 'Only HR prepares payroll.');
        if (run.status !== 'DRAFT') fail(409, 'LOCKED', 'This payroll is not a draft.');
        computeRun(db, run);
        run.status = 'SUBMITTED';
        run.submittedAt = at;
        run.sentBackNote = null;
      } else if (step === 'approve' || step === 'send-back') {
        NEED(ctx, 'payroll.approve', 'Only Leadership approves payroll.');
        if (run.status !== 'SUBMITTED') fail(409, 'NOT_SUBMITTED', 'This payroll is not waiting for approval.');
        if (run.preparedBy === ctx.userId) fail(403, 'SAME_PERSON', 'You prepared this payroll, so someone else approves it.');
        if (step === 'approve') {
          run.status = 'APPROVED';
          run.approvedBy = ctx.userId;
          run.approvedAt = at;
        } else {
          const note = String(ctx.body?.note ?? '').trim();
          if (note.length < 5) fail(400, 'NOTE_NEEDED', 'Say what needs fixing.');
          run.status = 'DRAFT';
          run.sentBackNote = note;
          run.submittedAt = null;
        }
      } else if (step === 'release') {
        if (!can(ctx, 'payroll.run') && !can(ctx, 'payroll.approve')) fail(403, 'FORBIDDEN', 'Only payroll releases payslips.');
        if (run.status !== 'APPROVED') fail(409, 'NOT_APPROVED', 'Approve the payroll before releasing payslips.');
        run.status = 'RELEASED';
        run.releasedAt = at;
      }
      for (const p of db.payslips) if (p.runId === run.id) p.status = run.status;
      return runView(db, run);
    }, true),
  ],
  [
    'GET',
    /^\/hr\/payroll\/([^/]+)\/bank-file$/,
    withDb((db, ctx) => {
      if (!can(ctx, 'payroll.run') && !can(ctx, 'payroll.approve')) fail(403, 'FORBIDDEN', 'Only payroll downloads the bank file.');
      const run = db.runs.find((r) => r.id === ctx.params[0]) ?? fail(404, 'NOT_FOUND', 'No such payroll.');
      if (run.status !== 'APPROVED' && run.status !== 'RELEASED') fail(409, 'NOT_APPROVED', 'The bank file is ready once the payroll is approved.');
      const rows = db.payslips
        .filter((p) => p.runId === run.id)
        .map((p) => {
          const e = employee(db, p.employeeId);
          return { name: e.bank?.holder ?? e.name, accountNo: e.bank?.accountNo ?? null, ifsc: e.bank?.ifsc ?? null, netPaise: p.netPaise, code: e.code };
        });
      return { filename: `salary-${run.month}.csv`, csv: bankFileCsv(rows, monthLabel(run.month)) };
    }),
  ],
  [
    'GET',
    /^\/hr\/settings$/,
    withDb((db, ctx) => {
      ONLY_HR(ctx);
      return { policy: db.policy, places: db.places, holidays: [...db.holidays].sort((a, b) => a.date.localeCompare(b.date)), canEdit: can(ctx, 'hr.manage') };
    }),
  ],
  [
    'PUT',
    /^\/hr\/settings$/,
    withDb((db, ctx) => {
      NEED(ctx, 'hr.manage', 'Only HR changes HR settings.');
      const b = ctx.body ?? {};
      if (b.policy) {
        const p = b.policy as HrPolicy;
        if (!/^\d{2}:\d{2}$/.test(p.shiftStart) || !/^\d{2}:\d{2}$/.test(p.shiftEnd) || p.shiftEnd <= p.shiftStart) fail(400, 'BAD_SHIFT', 'The shift has to end after it starts.');
        if (!(p.geofenceMeters >= 50 && p.geofenceMeters <= 5000)) fail(400, 'BAD_RADIUS', 'Keep the office radius between 50 m and 5 km.');
        db.policy = { ...db.policy, ...p };
      }
      if (Array.isArray(b.places)) db.places = b.places;
      return { policy: db.policy, places: db.places };
    }, true),
  ],
  [
    'POST',
    /^\/hr\/holidays$/,
    withDb((db, ctx) => {
      NEED(ctx, 'hr.manage', 'Only HR keeps the holiday list.');
      const { date, name, optional } = ctx.body ?? {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) fail(400, 'BAD_DATE', 'Choose the date.');
      if (String(name ?? '').trim().length < 2) fail(400, 'NAME_NEEDED', 'Name the holiday.');
      if (db.holidays.some((h) => h.date === date && !h.optional && !optional)) fail(409, 'EXISTS', 'There is already a holiday that day.');
      const h: Holiday = { id: nextId(db, 'hol'), date, name: String(name).trim(), branches: null, optional: !!optional };
      db.holidays.push(h);
      return h;
    }, true),
  ],
  [
    'DELETE',
    /^\/hr\/holidays\/([^/]+)$/,
    withDb((db, ctx) => {
      NEED(ctx, 'hr.manage', 'Only HR keeps the holiday list.');
      const before = db.holidays.length;
      db.holidays = db.holidays.filter((h) => h.id !== ctx.params[0]);
      if (db.holidays.length === before) fail(404, 'NOT_FOUND', 'No such holiday.');
      return { ok: true };
    }, true),
  ],
  [
    'GET',
    /^\/me\/team$/,
    withDb((db, ctx) => {
      const me = meOf(db, ctx);
      const t = today();
      const reports = db.employees.filter((e) => e.managerId === me.id && e.status !== 'EXITED');
      return {
        members: reports.map((r) => ({ ...view(db, r, false), day: daysOf(db, r, [t])[0], balances: balancesOf(db, r) })),
        pending: pendingFor(db, (e) => e.managerId === me.id),
      };
    }),
  ],
];

/** For tests: the live HR data. */
export function hrDbForTests(): HrDb {
  return load();
}
