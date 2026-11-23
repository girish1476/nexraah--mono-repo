import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mintAccessToken, mockAdapter } from './index';
import { resetHr } from './hr';
import { ROLE_CODES, type RoleCode } from '../lib/permissions';

/**
 * HR end to end against the in-browser data: every role reaches My HR; a
 * check-in is checked against the branch; leave goes to the manager; payroll
 * is prepared by HR and approved by somebody else; payslips reach only
 * their owner and payroll.
 */

const call = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  localStorage.setItem('token', mintAccessToken(role));
  const res = await mockAdapter({ method, url, data, headers: {} } as never);
  return (res.data as { data: any }).data;
};
const failure = async (role: RoleCode, method: string, url: string, data?: unknown) => {
  try {
    await call(role, method, url, data);
  } catch (e) {
    return (e as { response?: { data?: { error?: { code?: string } } } }).response?.data?.error?.code ?? (e as Error).message;
  }
  return null;
};

// Monday 23 November 2026, 10:05 in India.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T04:35:00Z'));
  localStorage.clear();
  resetHr();
});
afterAll(() => vi.useRealTimers());

const HO = { lat: 17.6868, lng: 83.2185 };

describe('My HR', () => {
  it('opens for every role, loading supervisors included', async () => {
    for (const role of ROLE_CODES) {
      const me = await call(role, 'GET', '/me/hr');
      expect(me.employee.name, role).toBeTruthy();
      expect(me.balances.length).toBeGreaterThan(0);
    }
  });

  it('asks for a reason away from the branch, and checks in at it', async () => {
    expect(await failure('FINANCE', 'POST', '/me/attendance/check-in', { lat: 17.8, lng: 83.4 })).toBe('OUTSIDE_BRANCH');
    expect(await failure('FINANCE', 'POST', '/me/attendance/check-in', {})).toBe('LOCATION_UNKNOWN');
    const day = await call('FINANCE', 'POST', '/me/attendance/check-in', { ...HO });
    expect(day.status).toBe('LATE'); // 10:05 is past 09:30 + 15 minutes' grace
    expect(day.inPlace.withinBranch).toBe(true);
    expect(await failure('FINANCE', 'POST', '/me/attendance/check-in', { ...HO })).toBe('ALREADY_IN');
    const out = await call('FINANCE', 'POST', '/me/attendance/check-out', { ...HO });
    expect(out.checkOut).toBeTruthy();
  });

  it('records on-duty work away from the branch with the reason given', async () => {
    const day = await call('BD', 'POST', '/me/attendance/check-in', { lat: 17.75, lng: 83.3, note: 'Client meeting at the steel plant' });
    expect(day.status).toBe('ON_DUTY');
    expect(day.inPlace.note).toMatch(/steel plant/);
  });

  it('sends leave to the manager, who approves it — and nobody approves their own', async () => {
    // Ravi Kumar (loading supervisor) reports to Anil Deshmukh (Operations).
    const req = await call('LOADING_SUPERVISOR', 'POST', '/me/leave', { type: 'CL', from: '2026-12-07', to: '2026-12-08', reason: 'Family function' });
    expect(req.status).toBe('PENDING');
    expect(req.days).toBe(2);
    const team = await call('OPS', 'GET', '/me/team');
    expect(team.pending.some((p: any) => p.id === req.id)).toBe(true);
    // Compliance is not his manager and does not hold leave.approve.
    expect(await failure('COMPLIANCE', 'POST', `/hr/leave/${req.id}/decide`, { decision: 'APPROVE' })).toBe('FORBIDDEN');
    const done = await call('OPS', 'POST', `/hr/leave/${req.id}/decide`, { decision: 'APPROVE' });
    expect(done.status).toBe('APPROVED');
    const mine = await call('LOADING_SUPERVISOR', 'GET', '/me/leave');
    expect(mine.balances.find((b: any) => b.code === 'CL').used).toBeGreaterThanOrEqual(2);
  });

  it('refuses leave that is not there, or that overlaps', async () => {
    expect(await failure('BD', 'POST', '/me/leave', { type: 'CL', from: '2026-12-01', to: '2026-12-31', reason: 'Long trip' })).toBe('LEAVE_REFUSED');
    await call('BD', 'POST', '/me/leave', { type: 'PL', from: '2026-12-14', to: '2026-12-14', reason: 'Errand' });
    expect(await failure('BD', 'POST', '/me/leave', { type: 'CL', from: '2026-12-14', to: '2026-12-15', reason: 'Errand' })).toBe('LEAVE_REFUSED');
  });

  it('keeps a correction waiting for the manager, then fixes the day', async () => {
    const c = await call('LOADING_SUPERVISOR', 'POST', '/me/corrections', { date: '2026-11-20', checkIn: '07:45', checkOut: '17:00', reason: 'Early port loading' });
    expect(c.status).toBe('PENDING');
    await call('HR', 'POST', `/hr/corrections/${c.id}/decide`, { decision: 'APPROVE' });
    const month = await call('LOADING_SUPERVISOR', 'GET', '/me/attendance?month=2026-11');
    const day = month.days.find((d: any) => d.date === '2026-11-20');
    expect(day.checkIn).toBe('2026-11-20T02:15:00.000Z');
  });
});

describe('the HR desk', () => {
  it('is closed to the freight desks and open to HR, Leadership and Administration', async () => {
    for (const role of ['OPS', 'COMPLIANCE', 'FINANCE', 'BD', 'LOADING_SUPERVISOR'] as RoleCode[]) {
      expect(await failure(role, 'GET', '/hr/overview'), role).toBe('FORBIDDEN');
    }
    for (const role of ['HR', 'LEADERSHIP', 'ADMIN'] as RoleCode[]) {
      const o = await call(role, 'GET', '/hr/overview');
      expect(o.headcount).toBeGreaterThan(10);
    }
  });

  it('adds an employee with a suggested salary split', async () => {
    const e = await call('HR', 'POST', '/hr/employees', {
      name: 'Test Person',
      phone: '9876543210',
      joinedOn: '2026-11-02',
      branchCode: 'VZG',
      monthlyGrossRupees: 30000,
      designation: 'Operations executive',
      department: 'Operations',
    });
    expect(e.code).toMatch(/^NX-/);
    expect(e.monthlyGrossPaise).toBe(3_000_000);
    expect(e.salary.basicPaise).toBe(1_500_000);
    expect(await failure('LEADERSHIP', 'POST', '/hr/employees', { name: 'X' })).toBe('FORBIDDEN');
  });

  it('runs payroll with two people: HR prepares, Leadership approves, then payslips reach their owners', async () => {
    const list = await call('HR', 'GET', '/hr/payroll');
    expect(list.runs.map((r: any) => r.month)).toEqual(['2026-10', '2026-09']);
    const run = await call('HR', 'POST', '/hr/payroll', { month: '2026-11' });
    expect(run.status).toBe('DRAFT');
    expect(run.headcount).toBeGreaterThan(10);
    await call('HR', 'POST', `/hr/payroll/${run.id}/submit`);
    expect(await failure('HR', 'POST', `/hr/payroll/${run.id}/approve`)).toBe('FORBIDDEN');
    // Nobody can see November's payslip until it is released.
    const before = await call('FINANCE', 'GET', '/me/payslips');
    expect(before.some((p: any) => p.month === '2026-11')).toBe(false);
    await call('LEADERSHIP', 'POST', `/hr/payroll/${run.id}/approve`);
    const bank = await call('HR', 'GET', `/hr/payroll/${run.id}/bank-file`);
    expect(bank.csv.split('\r\n').length).toBeGreaterThan(5);
    await call('HR', 'POST', `/hr/payroll/${run.id}/release`);
    const after = await call('FINANCE', 'GET', '/me/payslips');
    const nov = after.find((p: any) => p.month === '2026-11');
    expect(nov.netPaise).toBeGreaterThan(0);
    // The owner opens it; a colleague on another desk cannot.
    expect((await call('FINANCE', 'GET', `/payslips/${nov.id}`)).employee.name).toBe('Rakesh Nair');
    expect(await failure('OPS', 'GET', `/payslips/${nov.id}`)).toBe('FORBIDDEN');
  });

  it('will not let whoever prepared a payroll approve it', async () => {
    // Administration holds both payroll permissions — and still cannot approve its own month.
    const run = await call('ADMIN', 'POST', '/hr/payroll', { month: '2026-08' });
    await call('ADMIN', 'POST', `/hr/payroll/${run.id}/submit`);
    expect(await failure('ADMIN', 'POST', `/hr/payroll/${run.id}/approve`)).toBe('SAME_PERSON');
  });

  it('shows payslip amounts that add up', async () => {
    const list = await call('HR', 'GET', '/hr/payroll');
    const oct = list.runs.find((r: any) => r.month === '2026-10');
    const detail = await call('HR', 'GET', `/hr/payroll/${oct.id}`);
    for (const r of detail.rows) expect(r.grossPaise - r.deductionsPaise).toBe(r.netPaise);
    expect(detail.rows.reduce((a: number, r: any) => a + r.netPaise, 0)).toBe(oct.netPaise);
  });
});
