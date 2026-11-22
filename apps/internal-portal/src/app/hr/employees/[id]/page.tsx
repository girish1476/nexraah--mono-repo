'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/apis';
import { DAY_STATUS_LABEL } from '@/lib/hr/attendance';
import { dateLabel, dayLabel, daysInMonth, hoursLabel, istClock, istDate, monthLabel, monthOf, shiftMonth, yearsBetween } from '@/lib/hr/calendar';
import { LEAVE_STATUS_LABEL } from '@/lib/hr/leave';
import { computePay, monthlyGross } from '@/lib/hr/payroll';
import { DEFAULT_BRANCH_PLACES, DEFAULT_POLICY, DEPARTMENTS, EMPLOYEE_STATUS_LABEL, EMPLOYMENT_LABEL } from '@/lib/hr/policy';
import { EmployeeDetail, getEmployee, getEmployees, setDay, updateEmployee, EmployeeRow } from '@/lib/hr/apis';
import type { AttendanceDay, DayStatus } from '@/lib/hr/types';
import { Dialog, ErrorState, Field, Loading, ModuleGuard, PageHeader, Stack, StatStrip, useCan, useToast } from '@/lib/ui';
import { Avatar, Balance, Card, DayPill, Empty, Facts, Legend, MonthCalendar, Tabs, daysWord, fmtDays, rupees } from '@/components/hr/hr-ui';

type Tab = 'overview' | 'attendance' | 'leave' | 'salary' | 'payslips';

/** One person — `/hr/employees/[id]`. Everything HR holds about them, and changing it. */
export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const can = useCan();
  const canManage = can('hr.manage');
  const canPay = can('payroll.run');
  const [month, setMonth] = useState(monthOf(istDate(new Date())));
  const [data, setData] = useState<EmployeeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [leaving, setLeaving] = useState<{ status: 'ON_NOTICE' | 'EXITED' | 'ACTIVE'; exitOn: string } | null>(null);
  const [override, setOverride] = useState<{ day: AttendanceDay; status: DayStatus | ''; checkIn: string; checkOut: string; note: string } | null>(null);
  const [people, setPeople] = useState<EmployeeRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getEmployee(id, month).then(setData).catch((e) => setError(errorMessage(e)));
  }, [id, month]);
  useEffect(load, [load]);
  useEffect(() => {
    getEmployees().then(setPeople).catch(() => undefined);
  }, []);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Opening the record" />;
  const e = data.employee;
  const today = istDate(new Date());

  const save = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await updateEmployee(e.id, body);
      toast(done);
      setEdit(null);
      setLeaving(null);
      load();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveDay = async () => {
    if (!override) return;
    setBusy(true);
    try {
      await setDay(e.id, override.day.date, { status: override.status, checkIn: override.checkIn, checkOut: override.checkOut, note: override.note });
      toast(`${dateLabel(override.day.date)} updated for ${e.name.split(' ')[0]}`);
      setOverride(null);
      load();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModuleGuard module="hr">
      <PageHeader title={e.name} sub={`${e.code} · ${e.designation} · ${e.branchName}`} module="hr" right={<Link href="/hr/employees" className="btn btn-secondary btn-sm">← Everyone</Link>} />
      <Stack gap={16}>
        <section className="hr-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <Avatar name={e.name} size={72} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <DayPill status={e.status === 'ACTIVE' ? 'PRESENT' : e.status === 'ON_NOTICE' ? 'LATE' : 'WEEKLY_OFF'}>{EMPLOYEE_STATUS_LABEL[e.status]}</DayPill>
              <DayPill status="ON_DUTY">{EMPLOYMENT_LABEL[e.employmentType]}</DayPill>
              {e.userId && <DayPill status="ON_LEAVE">🔑 Has a console login</DayPill>}
            </div>
            <div className="hr-muted" style={{ marginTop: 8, fontSize: 'var(--text-md)' }}>
              {e.department} · reports to {e.managerName ?? 'nobody'} · joined {dateLabel(e.joinedOn)} ({yearsBetween(e.joinedOn, today)} yr)
              {e.exitOn ? ` · last day ${dateLabel(e.exitOn)}` : ''}
            </div>
          </div>
          {canManage && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setEdit({
                    name: e.name,
                    email: e.email ?? '',
                    phone: e.phone,
                    designation: e.designation,
                    department: e.department,
                    branchCode: e.branchCode,
                    managerId: e.managerId ?? '',
                    joinedOn: e.joinedOn,
                    dob: e.dob ?? '',
                    gender: e.gender ?? '',
                    employmentType: e.employmentType,
                    pan: e.pan ?? '',
                    uan: e.uan ?? '',
                    esicNo: e.esicNo ?? '',
                    address: e.address ?? '',
                    bankName: e.bank?.bank ?? '',
                    accountNo: e.bank?.accountNo ?? '',
                    ifsc: e.bank?.ifsc ?? '',
                  })
                }
              >
                ✏️ Edit details
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setLeaving({ status: e.status === 'ACTIVE' ? 'ON_NOTICE' : 'ACTIVE', exitOn: e.exitOn ?? '' })}>
                {e.status === 'ACTIVE' ? '📦 Mark as leaving' : '↩️ Keep on the rolls'}
              </button>
            </div>
          )}
        </section>

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'attendance', label: 'Attendance' },
            { id: 'leave', label: 'Leave' },
            { id: 'salary', label: 'Salary' },
            { id: 'payslips', label: `Payslips (${data.payslips.length})` },
          ]}
        />

        {tab === 'overview' && (
          <div className="hr-grid is-2">
            <Card title="Job" emoji="💼">
              <Facts
                items={[
                  ['Employee code', e.code],
                  ['Designation', e.designation],
                  ['Department', e.department],
                  ['Branch', e.branchName],
                  ['Reports to', e.managerName ?? '—'],
                  ['Team', data.reports.length ? data.reports.map((r) => r.name).join(', ') : 'Nobody reports to them'],
                  ['Joined', dateLabel(e.joinedOn)],
                ]}
              />
            </Card>
            <Card title="Personal" emoji="🪪">
              <Facts
                items={[
                  ['Mobile', <a key="p" href={`tel:+91${e.phone}`}>{e.phone}</a>],
                  ['Email', e.email ?? '—'],
                  ['Date of birth', dateLabel(e.dob)],
                  ['Address', e.address ?? '—'],
                  ['Emergency contact', e.emergency ? `${e.emergency.name} (${e.emergency.relation}) · ${e.emergency.phone}` : '—'],
                ]}
              />
            </Card>
            <Card title="Pay and statutory" emoji="🏦">
              <Facts
                items={[
                  ['Bank', e.bank ? `${e.bank.bank} · ${e.bank.accountNo}` : 'Not on file — they cannot be paid by transfer'],
                  ['IFSC', e.bank?.ifsc ?? '—'],
                  ['PAN', e.pan ?? '—'],
                  ['PF UAN', e.uan ?? '—'],
                  ['ESI number', e.esicNo ?? '—'],
                  ['Monthly gross', e.monthlyGrossPaise ? rupees(e.monthlyGrossPaise) : '—'],
                ]}
              />
            </Card>
            <Card title="Leave left" emoji="🌴">
              <Stack gap={12}>
                {data.balances.filter((b) => b.paid).map((b) => (
                  <Balance key={b.code} b={b} size={52} />
                ))}
              </Stack>
            </Card>
          </div>
        )}

        {tab === 'attendance' && (
          <Stack gap={14}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} disabled={month <= monthOf(e.joinedOn)} aria-label="Previous month">
                ‹
              </button>
              <strong style={{ minWidth: 130, textAlign: 'center' }}>{monthLabel(month)}</strong>
              <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= monthOf(today)} aria-label="Next month">
                ›
              </button>
            </div>
            <StatStrip
              compact
              stats={[
                { k: 'Present', emoji: '✅', v: fmtDays(data.summary.present + data.summary.onDuty) },
                { k: 'Late', emoji: '⏰', v: data.summary.late },
                { k: 'On leave', emoji: '🌴', v: fmtDays(data.summary.onLeave) },
                { k: 'Unpaid days', emoji: '🕳️', v: fmtDays(data.summary.lopDays), tone: data.summary.lopDays ? 'red' : undefined },
                { k: 'Average day', emoji: '⌛', v: data.summary.avgWorkedMinutes ? hoursLabel(data.summary.avgWorkedMinutes) : '—' },
              ]}
            />
            <Card title={monthLabel(month)} emoji="🗓️" right={<Legend statuses={['PRESENT', 'LATE', 'ON_DUTY', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY']} />}>
              <MonthCalendar
                days={data.days}
                today={today}
                onPick={
                  canManage
                    ? (d) => setOverride({ day: d, status: '', checkIn: d.checkIn ? istClock(d.checkIn) : '', checkOut: d.checkOut ? istClock(d.checkOut) : '', note: '' })
                    : undefined
                }
              />
              {canManage && <div className="hr-muted">Tap a day to correct it. Every change keeps HR’s note with the day.</div>}
            </Card>
          </Stack>
        )}

        {tab === 'leave' && (
          <Stack gap={14}>
            <div className="hr-grid">
              {data.balances.map((b) => (
                <div key={b.code} className="hr-card" style={{ borderTop: `3px solid ${b.hue}` }}>
                  <Balance b={b} />
                </div>
              ))}
            </div>
            <Card title="Requests" emoji="🗂️">
              {data.leaves.length ? (
                <div className="hr-list">
                  {data.leaves.map((l) => (
                    <div key={l.id} className="hr-row">
                      <div className="hr-row-main">
                        <div style={{ fontWeight: 650 }}>
                          {data.balances.find((b) => b.code === l.type)?.name ?? l.type} · {daysWord(l.days)}
                        </div>
                        <div className="hr-muted">
                          {l.from === l.to ? dayLabel(l.from, true) : `${dayLabel(l.from)} – ${dayLabel(l.to, true)}`} — “{l.reason}”
                        </div>
                      </div>
                      <DayPill status={l.status === 'APPROVED' ? 'PRESENT' : l.status === 'PENDING' ? 'LATE' : l.status === 'REJECTED' ? 'ABSENT' : 'WEEKLY_OFF'}>
                        {LEAVE_STATUS_LABEL[l.status]}
                      </DayPill>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty emoji="🏝️">No leave requests.</Empty>
              )}
            </Card>
          </Stack>
        )}

        {tab === 'salary' && <SalaryTab detail={data} canEdit={canPay} onSave={(salary) => save({ salary }, 'Salary saved — it applies from the next payroll you calculate')} busy={busy} />}

        {tab === 'payslips' && (
          <Card title="Payslips" emoji="🧾">
            {data.payslips.length ? (
              <div className="hr-list">
                {data.payslips.map((p) => (
                  <div key={p.id} className="hr-row">
                    <div className="hr-row-main">
                      <div style={{ fontWeight: 650 }}>{p.label}</div>
                      <div className="hr-muted">
                        Earned {rupees(p.grossPaise)} · take-home {rupees(p.netPaise)}
                      </div>
                    </div>
                    <DayPill status={p.status === 'RELEASED' ? 'PRESENT' : 'LATE'}>{p.status === 'RELEASED' ? 'Released' : 'Not released'}</DayPill>
                    <Link href={`/print/payslip/${p.id}`} target="_blank" className="btn btn-secondary btn-sm">
                      Open
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <Empty emoji="🧾">No payroll has included them yet.</Empty>
            )}
          </Card>
        )}
      </Stack>

      <Dialog
        open={!!edit}
        title={`Edit ${e.name.split(' ')[0]}’s details`}
        confirmLabel="Save"
        busy={busy}
        width={680}
        onConfirm={() =>
          edit &&
          void save(
            {
              name: edit.name,
              email: edit.email,
              phone: edit.phone,
              designation: edit.designation,
              department: edit.department,
              branchCode: edit.branchCode,
              managerId: edit.managerId || null,
              joinedOn: edit.joinedOn,
              dob: edit.dob || null,
              gender: edit.gender || null,
              employmentType: edit.employmentType,
              pan: edit.pan,
              uan: edit.uan,
              esicNo: edit.esicNo,
              address: edit.address,
              bank: edit.accountNo ? { bank: edit.bankName, accountNo: edit.accountNo, ifsc: edit.ifsc } : null,
            },
            'Saved',
          )
        }
        onClose={() => setEdit(null)}
      >
        {edit && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {(
              [
                ['name', 'Full name'],
                ['phone', 'Mobile'],
                ['email', 'Work email'],
                ['designation', 'Designation'],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l}>
                <input value={edit[k]} onChange={(ev) => setEdit({ ...edit, [k]: ev.target.value })} />
              </Field>
            ))}
            <Field label="Department">
              <select value={edit.department} onChange={(ev) => setEdit({ ...edit, department: ev.target.value })}>
                {[...new Set([...DEPARTMENTS, edit.department])].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </Field>
            <Field label="Branch">
              <select value={edit.branchCode} onChange={(ev) => setEdit({ ...edit, branchCode: ev.target.value })}>
                {DEFAULT_BRANCH_PLACES.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reports to">
              <select value={edit.managerId} onChange={(ev) => setEdit({ ...edit, managerId: ev.target.value })}>
                <option value="">Nobody</option>
                {people
                  .filter((p) => p.id !== e.id && p.status !== 'EXITED')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.designation}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Joined on">
              <input type="date" value={edit.joinedOn} onChange={(ev) => setEdit({ ...edit, joinedOn: ev.target.value })} />
            </Field>
            <Field label="Date of birth">
              <input type="date" value={edit.dob} onChange={(ev) => setEdit({ ...edit, dob: ev.target.value })} />
            </Field>
            <Field label="Employment">
              <select value={edit.employmentType} onChange={(ev) => setEdit({ ...edit, employmentType: ev.target.value })}>
                <option value="FULL_TIME">Full time</option>
                <option value="CONTRACT">Contract</option>
                <option value="INTERN">Intern</option>
              </select>
            </Field>
            {(
              [
                ['pan', 'PAN'],
                ['uan', 'PF UAN'],
                ['esicNo', 'ESI number'],
                ['bankName', 'Bank'],
                ['accountNo', 'Account number'],
                ['ifsc', 'IFSC'],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l}>
                <input value={edit[k]} onChange={(ev) => setEdit({ ...edit, [k]: k === 'pan' || k === 'ifsc' ? ev.target.value.toUpperCase() : ev.target.value })} />
              </Field>
            ))}
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Address">
                <textarea rows={2} value={edit.address} onChange={(ev) => setEdit({ ...edit, address: ev.target.value })} />
              </Field>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!leaving}
        title={leaving?.status === 'ACTIVE' ? `Keep ${e.name.split(' ')[0]} on the rolls?` : `${e.name.split(' ')[0]} is leaving`}
        body={
          leaving?.status === 'ACTIVE'
            ? 'They go back to active, with no last day.'
            : 'On notice: still paid and marking attendance until the last day. Left: off the rolls after the last day — later payrolls leave them out.'
        }
        confirmLabel="Save"
        confirmDisabled={!leaving || (leaving.status !== 'ACTIVE' && !leaving.exitOn)}
        busy={busy}
        onConfirm={() => leaving && void save({ status: leaving.status, exitOn: leaving.exitOn || null }, 'Saved')}
        onClose={() => setLeaving(null)}
      >
        {leaving && leaving.status !== 'ACTIVE' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Status">
              <select value={leaving.status} onChange={(ev) => setLeaving({ ...leaving, status: ev.target.value as 'ON_NOTICE' | 'EXITED' })}>
                <option value="ON_NOTICE">Serving notice</option>
                <option value="EXITED">Has left</option>
              </select>
            </Field>
            <Field label="Last working day">
              <input type="date" value={leaving.exitOn} onChange={(ev) => setLeaving({ ...leaving, exitOn: ev.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!override}
        title={override ? `${e.name.split(' ')[0]} · ${dayLabel(override.day.date, true)}` : ''}
        body={override ? `Now: ${override.day.holidayName ?? DAY_STATUS_LABEL[override.day.status] ?? '—'}. Change the times, or set the day outright.` : undefined}
        confirmLabel="Save the day"
        confirmDisabled={!override || override.note.trim().length < 3}
        busy={busy}
        onConfirm={() => void saveDay()}
        onClose={() => setOverride(null)}
      >
        {override && (
          <Stack gap={12}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Checked in">
                <input type="time" value={override.checkIn} onChange={(ev) => setOverride({ ...override, checkIn: ev.target.value })} />
              </Field>
              <Field label="Checked out">
                <input type="time" value={override.checkOut} onChange={(ev) => setOverride({ ...override, checkOut: ev.target.value })} />
              </Field>
            </div>
            <Field label="Set the day as" hint="Leave as worked out from the times, unless the day was something else.">
              <select value={override.status} onChange={(ev) => setOverride({ ...override, status: ev.target.value as DayStatus | '' })}>
                <option value="">Worked out from the times</option>
                {(['PRESENT', 'ON_DUTY', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY'] as DayStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {DAY_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Why" hint="Kept with the day, for anyone who looks later.">
              <input value={override.note} onChange={(ev) => setOverride({ ...override, note: ev.target.value })} placeholder="e.g. Biometric was down — manager confirmed" autoFocus />
            </Field>
          </Stack>
        )}
      </Dialog>
    </ModuleGuard>
  );
}

/** The salary structure, and a live look at a full month's payslip from it. */
function SalaryTab({ detail, canEdit, onSave, busy }: { detail: EmployeeDetail; canEdit: boolean; onSave: (s: Record<string, unknown>) => void; busy: boolean }) {
  const e = detail.employee;
  const s = e.salary!;
  const [f, setF] = useState({
    basicRupees: s.basicPaise / 100,
    hraRupees: s.hraPaise / 100,
    conveyanceRupees: s.conveyancePaise / 100,
    specialRupees: s.specialPaise / 100,
    tdsRupees: s.tdsMonthlyPaise / 100,
    pfApplicable: s.pfApplicable,
    pfOnFullBasic: s.pfOnFullBasic,
    effectiveFrom: s.effectiveFrom,
  });
  const structure = {
    basicPaise: Math.round(f.basicRupees * 100),
    hraPaise: Math.round(f.hraRupees * 100),
    conveyancePaise: Math.round(f.conveyanceRupees * 100),
    specialPaise: Math.round(f.specialRupees * 100),
    pfApplicable: f.pfApplicable,
    pfOnFullBasic: f.pfOnFullBasic,
    tdsMonthlyPaise: Math.round(f.tdsRupees * 100),
    effectiveFrom: f.effectiveFrom,
  };
  const month = monthOf(istDate(new Date()));
  const state = DEFAULT_BRANCH_PLACES.find((b) => b.code === e.branchCode)?.state ?? 'Andhra Pradesh';
  const pay = useMemo(
    () => computePay({ month, salary: structure, policy: DEFAULT_POLICY, state, gender: e.gender, daysInMonth: daysInMonth(month), lopDays: 0 }),
    [JSON.stringify(structure), month, state, e.gender], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const gross = monthlyGross(structure);
  const changed = JSON.stringify(structure) !== JSON.stringify(s);
  const employer = pay.employer.reduce((a, l) => a + l.amountPaise, 0);

  const num = (k: keyof typeof f) => (
    <input
      inputMode="decimal"
      disabled={!canEdit}
      value={String(f[k])}
      onChange={(ev) => setF({ ...f, [k]: Number(ev.target.value.replace(/[^\d.]/g, '')) || 0 })}
    />
  );

  return (
    <div className="hr-grid is-2">
      <Card title="Salary structure" emoji="🧮" right={<span className="hr-muted">Monthly</span>}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Basic (₹)">{num('basicRupees')}</Field>
          <Field label="House rent allowance (₹)">{num('hraRupees')}</Field>
          <Field label="Conveyance (₹)">{num('conveyanceRupees')}</Field>
          <Field label="Special allowance (₹)">{num('specialRupees')}</Field>
          <Field label="Income tax (TDS) each month (₹)" hint="From their tax declaration.">
            {num('tdsRupees')}
          </Field>
          <Field label="Applies from">
            <input type="date" disabled={!canEdit} value={f.effectiveFrom} onChange={(ev) => setF({ ...f, effectiveFrom: ev.target.value })} />
          </Field>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" disabled={!canEdit} checked={f.pfApplicable} onChange={(ev) => setF({ ...f, pfApplicable: ev.target.checked })} />
          Provident fund is deducted
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: f.pfApplicable ? 1 : 0.5 }}>
          <input type="checkbox" disabled={!canEdit || !f.pfApplicable} checked={f.pfOnFullBasic} onChange={(ev) => setF({ ...f, pfOnFullBasic: ev.target.checked })} />
          PF on the whole basic, not the ₹15,000 ceiling
        </label>
        <div className="hr-muted">
          Monthly gross {rupees(gross)} · yearly {rupees(gross * 12)}
          {structure.basicPaise < gross / 2 ? ' · Basic is under half of gross — the new labour codes count the excess allowances as wages.' : ''}
        </div>
        {canEdit && (
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!changed || busy || gross <= 0} onClick={() => onSave(f)}>
            Save salary
          </button>
        )}
      </Card>
      <Card title="A full month on this salary" emoji="🔍" right={<span className="hr-muted">{monthLabel(month)}, no unpaid days</span>}>
        <Facts
          items={[
            ...pay.earnings.map((l) => [l.label, rupees(l.amountPaise)] as [string, string]),
            ['Gross earnings', <strong key="g">{rupees(pay.grossPaise)}</strong>],
            ...pay.deductions.map((l) => [`− ${l.label}`, rupees(l.amountPaise)] as [string, string]),
            ['Take-home', <strong key="n" style={{ fontSize: 18 }}>{rupees(pay.netPaise)}</strong>],
          ]}
        />
        <div className="hr-muted">
          The company also pays {rupees(employer)} ({pay.employer.map((l) => l.label.replace('Employer ', '')).join(', ') || 'nothing'}) — a cost to company of {rupees(pay.grossPaise + employer)} a month.
          {pay.esiApplies ? ' ESI applies at this gross.' : ''}
        </div>
      </Card>
    </div>
  );
}
