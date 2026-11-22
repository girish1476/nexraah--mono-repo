/**
 * HR — the shapes shared by My HR (`/me`), the HR desk (`/hr`), the
 * in-browser data (`mocks/hr.ts`) and, later, the real API.
 *
 * Money is in paise, like everywhere else in the console. Dates are
 * `YYYY-MM-DD` in India time; moments are ISO strings.
 */

export type Paise = number;

export type EmploymentType = 'FULL_TIME' | 'CONTRACT' | 'INTERN';
export type EmployeeStatus = 'ACTIVE' | 'ON_NOTICE' | 'EXITED';

export interface SalaryStructure {
  /** Monthly, before any loss-of-pay proration. */
  basicPaise: Paise;
  hraPaise: Paise;
  conveyancePaise: Paise;
  specialPaise: Paise;
  /** Provident fund deducted at all. Off for someone outside PF. */
  pfApplicable: boolean;
  /** PF on the whole basic rather than on the ₹15,000 wage ceiling. */
  pfOnFullBasic: boolean;
  /** Income tax deducted at source each month — HR enters it from the employee's declaration. */
  tdsMonthlyPaise: Paise;
  effectiveFrom: string;
}

export interface BankAccount {
  holder: string;
  bank: string;
  accountNo: string;
  ifsc: string;
}

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
}

export interface Employee {
  id: string;
  code: string;
  /** The console login, when this person has one. Drivers and helpers often don't. */
  userId: string | null;
  name: string;
  email: string | null;
  phone: string;
  designation: string;
  department: string;
  branchCode: string;
  managerId: string | null;
  joinedOn: string;
  dob: string | null;
  gender: 'F' | 'M' | 'O' | null;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  exitOn: string | null;
  pan: string | null;
  uan: string | null;
  esicNo: string | null;
  address: string | null;
  bank: BankAccount | null;
  emergency: EmergencyContact | null;
  salary: SalaryStructure;
}

/** What a list or a card shows — the record plus names resolved for display. */
export interface EmployeeView extends Omit<Employee, 'salary' | 'bank' | 'pan'> {
  branchName: string;
  managerName: string | null;
  /** Masked unless the reader may see it in full (HR, or the person themselves). */
  pan: string | null;
  bank: BankAccount | null;
  /** Present only for readers allowed to see salaries. */
  salary?: SalaryStructure;
  monthlyGrossPaise?: Paise;
  reports: number;
}

/* ---- attendance --------------------------------------------------------- */

export type DayStatus =
  | 'PRESENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'ON_LEAVE'
  | 'ON_DUTY'
  | 'HOLIDAY'
  | 'WEEKLY_OFF'
  /** Today, before the person has checked in. */
  | 'NOT_YET'
  /** A future day, or before they joined. */
  | 'NONE';

export interface PunchPlace {
  lat: number | null;
  lng: number | null;
  /** Metres from the branch, when both points are known. */
  distanceM: number | null;
  withinBranch: boolean;
  /** Why it was outside or unknown, in the person's words. */
  note: string | null;
}

export interface AttendanceRecord {
  employeeId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  inPlace: PunchPlace | null;
  outPlace: PunchPlace | null;
  /** HR's override, if any — wins over what the punches say. */
  statusOverride: DayStatus | null;
  note: string | null;
  source: 'APP' | 'HR' | 'CORRECTION';
}

/** One day as every screen shows it: the status worked out, and the hours. */
export interface AttendanceDay {
  date: string;
  status: DayStatus;
  checkIn: string | null;
  checkOut: string | null;
  workedMinutes: number;
  lateByMinutes: number;
  inPlace: PunchPlace | null;
  outPlace: PunchPlace | null;
  holidayName: string | null;
  leaveType: string | null;
  note: string | null;
  /** A correction for this day is waiting on the manager. */
  correctionPending: boolean;
}

export interface MonthSummary {
  month: string;
  daysInMonth: number;
  workingDays: number;
  present: number;
  late: number;
  halfDays: number;
  absent: number;
  onLeave: number;
  onDuty: number;
  holidays: number;
  weeklyOffs: number;
  /** Days not paid: absences, unpaid leave, and half of each half day. */
  lopDays: number;
  avgWorkedMinutes: number;
}

export interface Correction {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  raisedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

/* ---- leave -------------------------------------------------------------- */

export interface LeaveType {
  code: string;
  name: string;
  /** Days a year. 0 for unpaid leave, which has no quota. */
  annualQuota: number;
  /** Most days that roll into next year. */
  carryForwardMax: number;
  paid: boolean;
  /** Can be applied for after the day (sick leave), not only ahead. */
  allowBackdated: boolean;
  emoji: string;
  hue: string;
}

export interface LeaveBalance {
  code: string;
  name: string;
  emoji: string;
  hue: string;
  paid: boolean;
  quota: number;
  carriedIn: number;
  used: number;
  pending: number;
  available: number;
}

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: string;
  from: string;
  to: string;
  /** A one-day request for half of it. */
  halfDay: 'FIRST' | 'SECOND' | null;
  days: number;
  reason: string;
  status: LeaveStatus;
  appliedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  /** `null` for every branch. */
  branches: string[] | null;
  optional: boolean;
}

/* ---- policy ------------------------------------------------------------- */

export interface PtSlab {
  /** Gross up to and including this, or `null` for "and above". */
  upToPaise: Paise | null;
  taxPaise: Paise;
  /** February's figure where a state collects more that month (Maharashtra). */
  februaryTaxPaise?: Paise;
}

export interface PtTable {
  state: string;
  slabs: PtSlab[];
  /** Women at or below this gross pay nothing (Maharashtra). */
  womenExemptUpToPaise?: Paise;
}

export interface HrPolicy {
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  /** Fewer worked hours than this is a half day. */
  fullDayMinutes: number;
  /** Fewer than this is not a day at all. */
  halfDayMinutes: number;
  geofenceMeters: number;
  /** 0 = Sunday … 6 = Saturday. */
  weeklyOffs: number[];
  /** Second and fourth Saturdays off, as many Indian offices keep them. */
  alternateSaturdaysOff: boolean;
  leaveTypes: LeaveType[];
  pfRatePct: number;
  pfWageCeilingPaise: Paise;
  epsRatePct: number;
  esiEmployeePct: number;
  esiEmployerPct: number;
  esiGrossLimitPaise: Paise;
  /** Professional tax by branch state. */
  ptTables: PtTable[];
}

export interface BranchPlace {
  code: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

/* ---- payroll ------------------------------------------------------------ */

export interface PayLine {
  code: string;
  label: string;
  amountPaise: Paise;
  /** What the full month would have been, before loss of pay. */
  fullPaise?: Paise;
}

export interface Payslip {
  id: string;
  runId: string;
  month: string;
  employeeId: string;
  employee: {
    code: string;
    name: string;
    designation: string;
    department: string;
    branchName: string;
    joinedOn: string;
    pan: string | null;
    uan: string | null;
    esicNo: string | null;
    bankName: string | null;
    accountNo: string | null;
    ifsc: string | null;
  };
  days: { inMonth: number; payable: number; lop: number; present: number; leave: number; holidays: number; weeklyOffs: number };
  earnings: PayLine[];
  deductions: PayLine[];
  employer: PayLine[];
  grossPaise: Paise;
  deductionsPaise: Paise;
  netPaise: Paise;
  status: PayrollStatus;
}

export type PayrollStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RELEASED';

export interface PayrollRun {
  id: string;
  month: string;
  status: PayrollStatus;
  preparedBy: string | null;
  preparedAt: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  sentBackNote: string | null;
  headcount: number;
  grossPaise: Paise;
  deductionsPaise: Paise;
  netPaise: Paise;
  employerCostPaise: Paise;
}

/** One row of a run, as the review table lists it. */
export interface PayslipRow {
  id: string;
  employeeId: string;
  code: string;
  name: string;
  designation: string;
  branchName: string;
  payableDays: number;
  lopDays: number;
  grossPaise: Paise;
  deductionsPaise: Paise;
  netPaise: Paise;
  /** Something HR should look at before submitting. */
  flags: string[];
}

/* ---- profile changes ---------------------------------------------------- */

/** A change to something payroll depends on (bank account, PAN), which HR confirms before it is used. */
export interface ProfileChange {
  id: string;
  employeeId: string;
  field: 'bank' | 'pan';
  before: string | null;
  after: string;
  /** The new bank account, when `field` is `bank`. */
  bank?: BankAccount;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  raisedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** Something waiting on a manager or HR, as an approvals list shows it. */
export interface PendingItem {
  kind: 'LEAVE' | 'CORRECTION' | 'PROFILE';
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  branchName: string;
  /** "Casual leave · 2 days · 1–2 Dec", "Missed check-out on 18 Nov" … */
  title: string;
  detail: string;
  raisedAt: string;
  leave?: LeaveRequest;
  correction?: Correction;
  change?: ProfileChange;
}
