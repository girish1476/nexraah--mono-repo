'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { dateLabel } from '@/lib/hr/calendar';
import { RunView, getPayroll, startPayroll } from '@/lib/hr/apis';
import { ErrorState, Loading, ModuleGuard, PageHeader, Stack, useToast } from '@/lib/ui';
import { Card, DayPill, Empty, RUN_WORD, rupees } from '@/components/hr/hr-ui';

/**
 * Payroll — `/hr/payroll`. One run per month: HR prepares it from the
 * month's attendance, Leadership approves it, then payslips are released
 * and the bank file is downloaded.
 */
export default function PayrollPage() {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<Awaited<ReturnType<typeof getPayroll>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getPayroll().then(setData).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Opening payroll" />;

  const start = async (month: string) => {
    setBusy(month);
    try {
      const run = await startPayroll(month);
      toast(`${run.label} calculated for ${run.headcount} people`);
      router.push(`/hr/payroll/${run.id}`);
    } catch (e) {
      toast(errorMessage(e));
      setBusy(null);
    }
  };

  const max = Math.max(...data.runs.map((r) => r.grossPaise), 1);

  return (
    <ModuleGuard module="hr">
      <PageHeader title="Payroll" sub="Each month: HR prepares it from attendance, Leadership approves it, then payslips go out." module="hr" />
      <Stack gap={16}>
        {data.canPrepare && data.openMonths.length > 0 && (
          <div className="hr-grid">
            {data.openMonths.map((m) => (
              <Card key={m.month} title={m.label} emoji="🆕">
                <div className="hr-muted">
                  {m.inProgress
                    ? 'This month is still running — days after today count as worked. Calculate now for a preview, and again at month end.'
                    : 'Not paid yet. Calculate it from the month’s attendance and leave.'}
                </div>
                <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!!busy} onClick={() => void start(m.month)}>
                  {busy === m.month ? 'Calculating…' : `Calculate ${m.label.split(' ')[0]}`}
                </button>
              </Card>
            ))}
          </div>
        )}

        <Card title="Months" emoji="🏦">
          {data.runs.length ? (
            <div className="hr-list">
              {data.runs.map((r: RunView) => (
                <Link key={r.id} href={`/hr/payroll/${r.id}`} className="hr-row" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div style={{ width: 110, flex: 'none' }}>
                    <div style={{ fontWeight: 750 }}>{r.label}</div>
                    <div className="hr-muted">{r.headcount} people</div>
                  </div>
                  <div className="hr-row-main">
                    <div className="meter" style={{ height: 10 }}>
                      <span style={{ width: `${(r.netPaise / max) * 100}%`, background: 'linear-gradient(90deg, var(--hr-people-a), var(--hr-people-b))' }} />
                    </div>
                    <div className="hr-muted" style={{ marginTop: 5 }}>
                      Take-home {rupees(r.netPaise)} · gross {rupees(r.grossPaise)} · cost to company {rupees(r.employerCostPaise)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <DayPill status={r.status === 'RELEASED' ? 'PRESENT' : r.status === 'APPROVED' ? 'ON_DUTY' : r.status === 'SUBMITTED' ? 'LATE' : 'WEEKLY_OFF'}>{RUN_WORD[r.status]}</DayPill>
                    <div className="hr-muted" style={{ marginTop: 4 }}>
                      {r.releasedAt ? `Released ${dateLabel(r.releasedAt)}` : r.preparedByName ? `By ${r.preparedByName}` : ''}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Empty emoji="🏦">No payroll yet.</Empty>
          )}
        </Card>
      </Stack>
    </ModuleGuard>
  );
}
