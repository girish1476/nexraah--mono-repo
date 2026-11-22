import { request } from '@/apis';
import type {
  AttendanceDay,
  BankAccount,
  BranchPlace,
  Correction,
  EmployeeView,
  Holiday,
  HrPolicy,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  MonthSummary,
  PayrollRun,
  Payslip,
  PayslipRow,
  PendingItem,
  ProfileChange,
  DayStatus,
} from './types';

/**
 * HR's calls. The in-browser data answers them on the demo site
 * (`mocks/hr.ts`); the real API will answer the same paths with the same
 * shapes.
 */

/* ---- My HR -------------------------------------------------------------- */

export interface MyHr {
  employee: EmployeeView;
  today: AttendanceDay;
  branch: BranchPlace;
  policy: { shiftStart: string; shiftEnd: string; graceMinutes: number; geofenceMeters: number; fullDayMinutes: number };
  month: MonthSummary;
  week: AttendanceDay[];
  balances: LeaveBalance[];
  holidays: Holiday[];
  myPending: PendingItem[];
  latestPayslip: { id: string; month: string; netPaise: number; grossPaise: number; deductionsPaise: number } | null;
  team: { size: number; today: { id: string; name: string; designation: string; day: AttendanceDay }[]; pending: PendingItem[] } | null;
}

export const getMyHr = () => request<MyHr>({ url: '/me/hr', method: 'GET' });

export interface PunchBody {
  lat?: number;
  lng?: number;
  accuracy?: number;
  note?: string;
}
export const checkIn = (body: PunchBody) => request<AttendanceDay>({ url: '/me/attendance/check-in', method: 'POST', data: body });
export const checkOut = (body: PunchBody) => request<AttendanceDay>({ url: '/me/attendance/check-out', method: 'POST', data: body });

export interface MyAttendance {
  month: string;
  days: AttendanceDay[];
  summary: MonthSummary;
  corrections: Correction[];
  joinedOn: string;
}
export const getMyAttendance = (month: string) => request<MyAttendance>({ url: '/me/attendance', method: 'GET', params: { month } });
export const raiseCorrection = (body: { date: string; checkIn: string | null; checkOut: string | null; reason: string }) =>
  request<Correction>({ url: '/me/corrections', method: 'POST', data: body });

export interface MyLeave {
  balances: LeaveBalance[];
  requests: LeaveRequest[];
  types: LeaveType[];
  holidays: Holiday[];
  approverName: string;
  branchCode: string;
  today: string;
}
export const getMyLeave = () => request<MyLeave>({ url: '/me/leave', method: 'GET' });
export const countLeaveDays = (from: string, to: string, half: string | null) =>
  request<{ days: number }>({ url: '/me/leave/days', method: 'GET', params: { from, to, half: half ?? '' } });
export const applyLeave = (body: { type: string; from: string; to: string; halfDay: 'FIRST' | 'SECOND' | null; reason: string }) =>
  request<LeaveRequest>({ url: '/me/leave', method: 'POST', data: body });
export const cancelLeave = (id: string) => request<LeaveRequest>({ url: `/me/leave/${id}/cancel`, method: 'POST' });

export interface PayslipSummary {
  id: string;
  month: string;
  label: string;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  payableDays: number;
  lopDays: number;
}
export const getMyPayslips = () => request<PayslipSummary[]>({ url: '/me/payslips', method: 'GET' });
export const getPayslip = (id: string) => request<Payslip & { label: string }>({ url: `/payslips/${id}`, method: 'GET' });

export interface MyProfile {
  employee: EmployeeView;
  changes: ProfileChange[];
  yearsWithUs: number;
  branch: BranchPlace;
}
export const getMyProfile = () => request<MyProfile>({ url: '/me/profile', method: 'GET' });
export const updateMyProfile = (body: { phone?: string; address?: string; emergency?: { name: string; relation: string; phone: string } | null }) =>
  request<EmployeeView>({ url: '/me/profile', method: 'PATCH', data: body });
export const requestProfileChange = (body: { field: 'bank'; bank: Partial<BankAccount>; reason: string } | { field: 'pan'; pan: string; reason: string }) =>
  request<ProfileChange>({ url: '/me/profile/changes', method: 'POST', data: body });

export interface TeamMember extends EmployeeView {
  day: AttendanceDay;
  balances: LeaveBalance[];
}
export const getMyTeam = () => request<{ members: TeamMember[]; pending: PendingItem[] }>({ url: '/me/team', method: 'GET' });

export const decideLeave = (id: string, decision: 'APPROVE' | 'REJECT', note?: string) =>
  request<LeaveRequest>({ url: `/hr/leave/${id}/decide`, method: 'POST', data: { decision, note } });
export const decideCorrection = (id: string, decision: 'APPROVE' | 'REJECT', note?: string) =>
  request<Correction>({ url: `/hr/corrections/${id}/decide`, method: 'POST', data: { decision, note } });

/* ---- the HR desk -------------------------------------------------------- */

export interface RunView extends PayrollRun {
  preparedByName: string | null;
  approvedByName: string | null;
  label: string;
}

export interface HrOverview {
  date: string;
  headcount: number;
  status: { in: number; late: number; onDuty: number; onLeave: number; notYet: number; absent: number; off: number };
  dayOff: string | null;
  branches: { code: string; name: string; total: number; in: number }[];
  departments: { name: string; count: number }[];
  trend: { date: string; present: number; total: number }[];
  pending: PendingItem[];
  changes: (ProfileChange & { employeeName: string })[];
  onLeaveToday: { id: string; name: string; designation: string; type: string; until: string }[];
  notIn: { id: string; name: string; designation: string; branchName: string; phone: string }[];
  celebrations: { name: string; kind: 'BIRTHDAY' | 'ANNIVERSARY'; date: string; years: number; designation: string }[];
  payroll: { month: string; label: string; run: RunView | null; last: RunView | null };
  upcomingHolidays: Holiday[];
  newJoiners: { id: string; name: string; designation: string; joinedOn: string }[];
}
export const getHrOverview = () => request<HrOverview>({ url: '/hr/overview', method: 'GET' });

export type EmployeeRow = EmployeeView & { today: DayStatus };
export const getEmployees = (q = '') => request<EmployeeRow[]>({ url: '/hr/employees', method: 'GET', params: { q } });

export interface NewEmployee {
  name: string;
  email?: string;
  phone: string;
  designation: string;
  department: string;
  branchCode: string;
  managerId?: string | null;
  joinedOn: string;
  dob?: string;
  gender?: 'F' | 'M' | 'O' | null;
  employmentType?: 'FULL_TIME' | 'CONTRACT' | 'INTERN';
  monthlyGrossRupees: number;
  tdsMonthlyRupees?: number;
  pan?: string;
  uan?: string;
  bank?: { bank: string; accountNo: string; ifsc: string };
}
export const addEmployee = (body: NewEmployee) => request<EmployeeView>({ url: '/hr/employees', method: 'POST', data: body });

export interface EmployeeDetail {
  employee: EmployeeView;
  month: string;
  days: AttendanceDay[];
  summary: MonthSummary;
  balances: LeaveBalance[];
  leaves: LeaveRequest[];
  payslips: { id: string; month: string; label: string; netPaise: number; grossPaise: number; status: string }[];
  reports: { id: string; name: string; designation: string }[];
  changes: ProfileChange[];
}
export const getEmployee = (id: string, month?: string) => request<EmployeeDetail>({ url: `/hr/employees/${id}`, method: 'GET', params: month ? { month } : {} });
export const updateEmployee = (id: string, body: Record<string, unknown>) => request<EmployeeView>({ url: `/hr/employees/${id}`, method: 'PATCH', data: body });

export interface BoardRow {
  id: string;
  code: string;
  name: string;
  designation: string;
  branchName: string;
  phone: string;
  day: AttendanceDay;
}
export const getBoard = (date: string, branch: string) =>
  request<{ date: string; rows: BoardRow[]; branches: { code: string; name: string }[] }>({ url: '/hr/attendance', method: 'GET', params: { date, branch } });
export interface RegisterRow {
  id: string;
  code: string;
  name: string;
  designation: string;
  days: { date: string; status: DayStatus; checkIn: string | null; checkOut: string | null }[];
  summary: MonthSummary;
}
export const getRegister = (month: string, branch: string) =>
  request<{ month: string; dates: string[]; rows: RegisterRow[] }>({ url: '/hr/attendance/register', method: 'GET', params: { month, branch } });
export const setDay = (employeeId: string, date: string, body: { status: DayStatus | ''; checkIn?: string; checkOut?: string; note: string }) =>
  request<AttendanceDay>({ url: `/hr/attendance/${employeeId}/${date}`, method: 'PUT', data: body });

export const getApprovals = () =>
  request<{ pending: PendingItem[]; changes: (ProfileChange & { employeeName: string; employeeCode: string })[] }>({ url: '/hr/approvals', method: 'GET' });
export const decideChange = (id: string, decision: 'APPROVE' | 'REJECT') =>
  request<ProfileChange>({ url: `/hr/profile-changes/${id}/decide`, method: 'POST', data: { decision } });

export interface LeaveDesk {
  month: string;
  dates: string[];
  pending: PendingItem[];
  calendar: (LeaveRequest & { employeeName: string; typeName: string; hue: string })[];
  recent: (LeaveRequest & { employeeName: string; typeName: string; decidedByName: string | null })[];
  balances: { id: string; name: string; code: string; balances: LeaveBalance[] }[];
  types: LeaveType[];
}
export const getLeaveDesk = (month: string) => request<LeaveDesk>({ url: '/hr/leave', method: 'GET', params: { month } });

export const getPayroll = () =>
  request<{ runs: RunView[]; canPrepare: boolean; canApprove: boolean; openMonths: { month: string; label: string; inProgress: boolean }[] }>({
    url: '/hr/payroll',
    method: 'GET',
  });
export const startPayroll = (month: string) => request<RunView>({ url: '/hr/payroll', method: 'POST', data: { month } });
export interface RunDetail {
  run: RunView;
  rows: PayslipRow[];
  canPrepare: boolean;
  canApprove: boolean;
  preparedByMe: boolean;
  unbanked: number;
  inProgress: boolean;
  statutory: { pf: number; esi: number; pt: number; tds: number };
}
export const getRun = (id: string) => request<RunDetail>({ url: `/hr/payroll/${id}`, method: 'GET' });
export const runStep = (id: string, step: 'recalculate' | 'submit' | 'approve' | 'send-back' | 'release', note?: string) =>
  request<RunView>({ url: `/hr/payroll/${id}/${step}`, method: 'POST', data: note ? { note } : {} });
export const getBankFile = (id: string) => request<{ filename: string; csv: string }>({ url: `/hr/payroll/${id}/bank-file`, method: 'GET' });

export interface HrSettings {
  policy: HrPolicy;
  places: BranchPlace[];
  holidays: Holiday[];
  canEdit: boolean;
}
export const getHrSettings = () => request<HrSettings>({ url: '/hr/settings', method: 'GET' });
export const saveHrSettings = (body: { policy?: Partial<HrPolicy>; places?: BranchPlace[] }) =>
  request<{ policy: HrPolicy; places: BranchPlace[] }>({ url: '/hr/settings', method: 'PUT', data: body });
export const addHoliday = (body: { date: string; name: string; optional: boolean }) => request<Holiday>({ url: '/hr/holidays', method: 'POST', data: body });
export const removeHoliday = (id: string) => request<{ ok: true }>({ url: `/hr/holidays/${id}`, method: 'DELETE' });
