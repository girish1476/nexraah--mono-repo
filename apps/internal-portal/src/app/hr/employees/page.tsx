'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/apis';
import { istDate } from '@/lib/hr/calendar';
import { DEFAULT_BRANCH_PLACES, DEPARTMENTS, EMPLOYEE_STATUS_LABEL } from '@/lib/hr/policy';
import { suggestStructure } from '@/lib/hr/payroll';
import { EmployeeRow, NewEmployee, addEmployee, getEmployees } from '@/lib/hr/apis';
import { Column, DataTable, Dialog, ErrorState, Field, Loading, ModuleGuard, PageHeader, Stack, StatStrip, Toolbar, useCan, useToast } from '@/lib/ui';
import { DayPill, Person, rupees } from '@/components/hr/hr-ui';

/** Employees — `/hr/employees`. Everyone on the rolls, and adding someone new. */
export default function EmployeesPage() {
  const router = useRouter();
  const toast = useToast();
  const canManage = useCan()('hr.manage');
  const [rows, setRows] = useState<EmployeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [form, setForm] = useState<NewEmployee | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getEmployees().then(setRows).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (e) =>
        (status === 'ALL' || e.status !== 'EXITED') &&
        (!dept || e.department === dept) &&
        (!branch || e.branchCode === branch) &&
        (!needle || [e.name, e.code, e.designation, e.phone, e.email ?? ''].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [rows, q, dept, branch, status]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Reading the rolls" />;

  const active = rows.filter((e) => e.status !== 'EXITED');
  const monthly = active.reduce((a, e) => a + (e.monthlyGrossPaise ?? 0), 0);
  const managers = active.filter((e) => e.reports > 0 || ['Leadership', 'Operations'].includes(e.department));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const e = await addEmployee(form);
      toast(`${e.name} added as ${e.code}`);
      setForm(null);
      router.push(`/hr/employees/${e.id}`);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<EmployeeRow>[] = [
    { key: 'name', label: 'Person', render: (e) => <Person name={e.name} sub={`${e.code} · ${e.designation}`} size={34} /> },
    { key: 'dept', label: 'Department', render: (e) => e.department },
    { key: 'branch', label: 'Branch', render: (e) => e.branchName },
    { key: 'manager', label: 'Reports to', render: (e) => e.managerName ?? '—' },
    { key: 'today', label: 'Today', render: (e) => (e.status === 'EXITED' ? <DayPill status="WEEKLY_OFF">Left</DayPill> : <DayPill status={e.today} />) },
    { key: 'pay', label: 'Monthly gross', align: 'right', render: (e) => (e.monthlyGrossPaise ? rupees(e.monthlyGrossPaise) : '—') },
    {
      key: 'status',
      label: '',
      render: (e) => (e.status === 'ON_NOTICE' ? <DayPill status="LATE">{EMPLOYEE_STATUS_LABEL[e.status]}</DayPill> : e.userId ? <span className="hr-muted" title="Signs in to the console">🔑 Login</span> : null),
    },
  ];

  const gross = form?.monthlyGrossRupees ? suggestStructure(Math.round(form.monthlyGrossRupees * 100)) : null;

  return (
    <ModuleGuard module="hr">
      <PageHeader
        title="Employees"
        sub="Everyone on the rolls — with a login or without (drivers and helpers often have none)."
        module="hr"
        right={
          canManage && (
            <button
              className="btn"
              onClick={() =>
                setForm({ name: '', phone: '', email: '', designation: '', department: 'Operations', branchCode: 'VZG', joinedOn: istDate(new Date()), monthlyGrossRupees: 0, managerId: null, employmentType: 'FULL_TIME', gender: null })
              }
            >
              ＋ Add employee
            </button>
          )
        }
      />
      <Stack gap={16}>
        <StatStrip
          compact
          stats={[
            { k: 'On the rolls', emoji: '👥', v: active.length },
            { k: 'With a console login', emoji: '🔑', v: active.filter((e) => e.userId).length },
            { k: 'Monthly gross', emoji: '💰', v: rupees(monthly) },
            { k: 'On notice', emoji: '📦', v: active.filter((e) => e.status === 'ON_NOTICE').length },
          ]}
        />
        <Toolbar
          search={
            <input
            placeholder="Search by name, code, role or phone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search employees"
            />
          }
        >
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
            <option value="">Every department</option>
            {[...new Set(rows.map((r) => r.department))].sort().map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
            <option value="">Every branch</option>
            {[...new Map(rows.map((r) => [r.branchCode, r.branchName])).entries()].map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'ALL')} aria-label="Status">
            <option value="ACTIVE">Current staff</option>
            <option value="ALL">Including people who left</option>
          </select>
        </Toolbar>
        <div className="surface">
          <DataTable columns={columns} rows={shown} rowKey={(e) => e.id} onRowClick={(e) => router.push(`/hr/employees/${e.id}`)} empty="Nobody matches that." />
        </div>
      </Stack>

      <Dialog
        open={!!form}
        title="Add an employee"
        body="Their code is given automatically. Add the details you have now — the rest can follow."
        confirmLabel="Add employee"
        confirmDisabled={!form || form.name.trim().length < 2 || !/^[6-9]\d{9}$/.test(form.phone) || !(form.monthlyGrossRupees > 0)}
        busy={busy}
        onConfirm={() => void save()}
        onClose={() => setForm(null)}
        width={640}
      >
        {form && (
          <Stack gap={12}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <Field label="Full name" required>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              </Field>
              <Field label="Mobile" required>
                <input inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
              </Field>
              <Field label="Work email" hint="Same as their console login, if they have one — that links the two.">
                <input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Designation">
                <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Operations executive" />
              </Field>
              <Field label="Department">
                <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                  {DEPARTMENTS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </Field>
              <Field label="Branch">
                <select value={form.branchCode} onChange={(e) => setForm({ ...form, branchCode: e.target.value })}>
                  {DEFAULT_BRANCH_PLACES.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reports to">
                <select value={form.managerId ?? ''} onChange={(e) => setForm({ ...form, managerId: e.target.value || null })}>
                  <option value="">Nobody</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.designation}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Joins on" required>
                <input type="date" value={form.joinedOn} onChange={(e) => setForm({ ...form, joinedOn: e.target.value })} />
              </Field>
              <Field label="Employment">
                <select value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value as NewEmployee['employmentType'] })}>
                  <option value="FULL_TIME">Full time</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="INTERN">Intern</option>
                </select>
              </Field>
              <Field label="Gender" hint="Used only for professional tax rules.">
                <select value={form.gender ?? ''} onChange={(e) => setForm({ ...form, gender: (e.target.value || null) as NewEmployee['gender'] })}>
                  <option value="">Prefer not to say</option>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                  <option value="O">Other</option>
                </select>
              </Field>
              <Field label="Monthly gross salary (₹)" required>
                <input inputMode="numeric" value={form.monthlyGrossRupees || ''} onChange={(e) => setForm({ ...form, monthlyGrossRupees: Number(e.target.value.replace(/\D/g, '')) })} placeholder="e.g. 30000" />
              </Field>
              <Field label="PAN">
                <input value={form.pan ?? ''} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase().slice(0, 10) })} />
              </Field>
            </div>
            {gross && (
              <div className="hr-card" style={{ padding: '10px 14px', background: 'var(--color-surface-sunken)', boxShadow: 'none' }}>
                <strong>Suggested split</strong>
                <span className="hr-muted">
                  {' '}
                  — basic {rupees(gross.basicPaise)} · HRA {rupees(gross.hraPaise)} · conveyance {rupees(gross.conveyancePaise)} · special {rupees(gross.specialPaise)}. Change it on their page.
                </span>
              </div>
            )}
          </Stack>
        )}
      </Dialog>
    </ModuleGuard>
  );
}
