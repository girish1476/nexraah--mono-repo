import { describe, expect, it } from 'vitest';
import { dayFor, isWeeklyOff, metresBetween, summarise } from './attendance';
import { istMoment } from './calendar';
import { balances, leaveDays, leaveProblem } from './leave';
import { bankFileCsv, computePay, professionalTax, suggestStructure } from './payroll';
import { DEFAULT_POLICY } from './policy';
import { AttendanceRecord, LeaveRequest } from './types';

const policy = DEFAULT_POLICY;
const ctx = (date: string, over: Partial<Parameters<typeof dayFor>[1]> = {}) => ({
  date,
  today: '2026-11-20',
  now: istMoment('2026-11-20', '15:00'),
  joinedOn: '2024-01-01',
  exitOn: null,
  policy,
  branchCode: 'VZG',
  holidays: [],
  leaves: [],
  correctionPending: false,
  ...over,
});
const punch = (date: string, inAt: string, outAt: string | null, within = true): AttendanceRecord => ({
  employeeId: 'e1',
  date,
  checkIn: istMoment(date, inAt),
  checkOut: outAt ? istMoment(date, outAt) : null,
  inPlace: { lat: 0, lng: 0, distanceM: within ? 40 : 9000, withinBranch: within, note: within ? null : 'Client visit' },
  outPlace: null,
  statusOverride: null,
  note: null,
  source: 'APP',
});

describe('a day of attendance', () => {
  it('is present on time, late past the grace, a half day short of eight hours', () => {
    expect(dayFor(punch('2026-11-18', '09:35', '18:40'), ctx('2026-11-18')).status).toBe('PRESENT');
    const late = dayFor(punch('2026-11-18', '10:05', '19:00'), ctx('2026-11-18'));
    expect(late.status).toBe('LATE');
    expect(late.lateByMinutes).toBe(35);
    expect(dayFor(punch('2026-11-18', '09:30', '15:00'), ctx('2026-11-18')).status).toBe('HALF_DAY');
    expect(dayFor(punch('2026-11-18', '09:30', '11:00'), ctx('2026-11-18')).status).toBe('ABSENT');
  });

  it('is on duty when checked in away from the branch', () => {
    expect(dayFor(punch('2026-11-18', '09:30', '18:30', false), ctx('2026-11-18')).status).toBe('ON_DUTY');
  });

  it('counts today’s hours up to now while the shift is open', () => {
    const d = dayFor(punch('2026-11-20', '09:30', null), ctx('2026-11-20'));
    expect(d.status).toBe('PRESENT');
    expect(d.workedMinutes).toBe(330);
  });

  it('is absent for a working day gone by with no punch, and not yet for today', () => {
    expect(dayFor(undefined, ctx('2026-11-19')).status).toBe('ABSENT');
    expect(dayFor(undefined, ctx('2026-11-20')).status).toBe('NOT_YET');
  });

  it('keeps Sundays and the 2nd and 4th Saturdays off', () => {
    expect(isWeeklyOff('2026-11-22', policy)).toBe(true); // Sunday
    expect(isWeeklyOff('2026-11-14', policy)).toBe(true); // 2nd Saturday
    expect(isWeeklyOff('2026-11-07', policy)).toBe(false); // 1st Saturday
    expect(dayFor(undefined, ctx('2026-11-15')).status).toBe('WEEKLY_OFF');
  });

  it('shows holidays and approved leave, and an override wins', () => {
    const holidays = [{ id: 'h', date: '2026-11-19', name: 'Test day', branches: null, optional: false }];
    expect(dayFor(undefined, ctx('2026-11-19', { holidays })).status).toBe('HOLIDAY');
    const leaves: LeaveRequest[] = [
      { id: 'l', employeeId: 'e1', type: 'CL', from: '2026-11-18', to: '2026-11-18', halfDay: null, days: 1, reason: 'x', status: 'APPROVED', appliedAt: '', decidedBy: null, decidedAt: null, decisionNote: null },
    ];
    expect(dayFor(undefined, ctx('2026-11-18', { leaves })).status).toBe('ON_LEAVE');
    expect(dayFor({ ...punch('2026-11-18', '11:00', '12:00'), statusOverride: 'PRESENT' }, ctx('2026-11-18')).status).toBe('PRESENT');
  });

  it('counts unpaid days: absence 1, half day ½, unpaid leave 1, paid leave 0', () => {
    const leaves: LeaveRequest[] = [
      { id: 'a', employeeId: 'e1', type: 'LOP', from: '2026-11-02', to: '2026-11-02', halfDay: null, days: 1, reason: 'x', status: 'APPROVED', appliedAt: '', decidedBy: null, decidedAt: null, decisionNote: null },
      { id: 'b', employeeId: 'e1', type: 'CL', from: '2026-11-03', to: '2026-11-03', halfDay: null, days: 1, reason: 'x', status: 'APPROVED', appliedAt: '', decidedBy: null, decidedAt: null, decisionNote: null },
    ];
    const days = [
      dayFor(undefined, ctx('2026-11-02', { leaves })),
      dayFor(undefined, ctx('2026-11-03', { leaves })),
      dayFor(undefined, ctx('2026-11-04')),
      dayFor(punch('2026-11-05', '09:30', '15:00'), ctx('2026-11-05')),
    ];
    const s = summarise('2026-11', days, leaves, (t) => t !== 'LOP');
    expect(s.lopDays).toBe(2.5);
    expect(s.onLeave).toBe(2);
  });

  it('measures distance to the branch', () => {
    // Visakhapatnam to Vijayawada is roughly 350 km as the crow flies.
    const m = metresBetween({ lat: 17.6868, lng: 83.2185 }, { lat: 16.5062, lng: 80.648 });
    expect(m).toBeGreaterThan(300_000);
    expect(m).toBeLessThan(320_000);
  });
});

describe('leave', () => {
  it('does not count weekly offs or holidays inside a request', () => {
    // Fri 20 Nov → Mon 23 Nov: Saturday 21 is the 3rd (worked), Sunday off.
    expect(leaveDays('2026-11-20', '2026-11-23', null, policy, [], 'VZG')).toBe(3);
    expect(leaveDays('2026-11-20', '2026-11-20', 'FIRST', policy, [], 'VZG')).toBe(0.5);
  });

  it('keeps balances per type and refuses what is not there', () => {
    const reqs: LeaveRequest[] = [
      { id: 'a', employeeId: 'e1', type: 'CL', from: '2026-03-02', to: '2026-03-11', halfDay: null, days: 10, reason: 'x', status: 'APPROVED', appliedAt: '', decidedBy: null, decidedAt: null, decisionNote: null },
      { id: 'b', employeeId: 'e1', type: 'CL', from: '2026-12-01', to: '2026-12-01', halfDay: null, days: 1, reason: 'x', status: 'PENDING', appliedAt: '', decidedBy: null, decidedAt: null, decisionNote: null },
    ];
    const cl = balances(policy.leaveTypes, reqs, '2026').find((b) => b.code === 'CL')!;
    expect(cl.available).toBe(1);
    const type = policy.leaveTypes.find((t) => t.code === 'CL');
    expect(
      leaveProblem({ type: 'CL', from: '2026-12-10', to: '2026-12-11', halfDay: null, reason: 'Family function' }, { today: '2026-11-20', type, days: 2, balance: cl, existing: reqs }),
    ).toMatch(/Only 1 day/);
    expect(
      leaveProblem({ type: 'CL', from: '2026-11-18', to: '2026-11-18', halfDay: null, reason: 'Late notice' }, { today: '2026-11-20', type, days: 1, balance: cl, existing: [] }),
    ).toMatch(/ahead of time/);
    expect(
      leaveProblem({ type: 'CL', from: '2026-12-01', to: '2026-12-02', halfDay: null, reason: 'Trip' }, { today: '2026-11-20', type, days: 2, balance: { ...cl, available: 5 }, existing: reqs }),
    ).toMatch(/already have leave/);
  });
});

describe('payroll', () => {
  const salary = { basicPaise: 30_000_00, hraPaise: 12_000_00, conveyancePaise: 1_600_00, specialPaise: 6_400_00, pfApplicable: true, pfOnFullBasic: false, tdsMonthlyPaise: 0, effectiveFrom: '2026-04-01' };

  it('pays a full month: PF on the ₹15,000 ceiling, AP professional tax, no ESI above ₹21,000', () => {
    const p = computePay({ month: '2026-11', salary, policy, state: 'Andhra Pradesh', gender: 'M', daysInMonth: 30, lopDays: 0 });
    expect(p.grossPaise).toBe(50_000_00);
    expect(p.deductions.find((d) => d.code === 'PF')!.amountPaise).toBe(1_800_00);
    expect(p.deductions.find((d) => d.code === 'PT')!.amountPaise).toBe(200_00);
    expect(p.esiApplies).toBe(false);
    expect(p.netPaise).toBe(50_000_00 - 1_800_00 - 200_00);
    expect(p.employer.find((e) => e.code === 'EPS_ER')!.amountPaise).toBe(1_250_00);
  });

  it('takes loss-of-pay days off every earning', () => {
    const p = computePay({ month: '2026-11', salary, policy, state: 'Andhra Pradesh', gender: 'M', daysInMonth: 30, lopDays: 3 });
    expect(p.payableDays).toBe(27);
    expect(p.grossPaise).toBe(45_000_00);
  });

  it('deducts ESI at or under ₹21,000 gross, rounded up', () => {
    const small = { ...salary, ...suggestStructure(18_000_00) };
    const p = computePay({ month: '2026-11', salary: small, policy, state: 'Andhra Pradesh', gender: 'F', daysInMonth: 30, lopDays: 0 });
    expect(p.esiApplies).toBe(true);
    expect(p.deductions.find((d) => d.code === 'ESI')!.amountPaise).toBe(135_00);
    expect(p.employer.find((d) => d.code === 'ESI_ER')!.amountPaise).toBe(585_00);
    expect(p.deductions.find((d) => d.code === 'PT')!.amountPaise).toBe(150_00);
  });

  it('applies Maharashtra’s February figure and its exemption for women', () => {
    const mh = policy.ptTables.find((t) => t.state === 'Maharashtra');
    expect(professionalTax(mh, 30_000_00, '2027-02', 'M')).toBe(300_00);
    expect(professionalTax(mh, 30_000_00, '2026-11', 'M')).toBe(200_00);
    expect(professionalTax(mh, 22_000_00, '2026-11', 'F')).toBe(0);
  });

  it('never pays a negative amount', () => {
    const p = computePay({ month: '2026-11', salary: { ...salary, tdsMonthlyPaise: 90_000_00 }, policy, state: 'Andhra Pradesh', gender: 'M', daysInMonth: 30, lopDays: 0 });
    expect(p.netPaise).toBe(0);
  });

  it('writes a bank sheet only for people with an account and pay', () => {
    const csv = bankFileCsv(
      [
        { name: 'A, B', accountNo: '123', ifsc: 'HDFC0000001', netPaise: 1_000_00, code: 'NX-1' },
        { name: 'No account', accountNo: null, ifsc: null, netPaise: 1_000_00, code: 'NX-2' },
      ],
      'Nov 2026',
    ).split('\r\n');
    expect(csv).toHaveLength(2);
    expect(csv[1]).toBe('"A, B",123,HDFC0000001,1000.00,Salary Nov 2026,NX-1');
  });
});
