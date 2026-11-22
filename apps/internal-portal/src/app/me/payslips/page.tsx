'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { monthLabel } from '@/lib/hr/calendar';
import { PayslipSummary, getMyPayslips } from '@/lib/hr/apis';
import { ErrorState, Loading, ModuleGuard, PageHeader, Stack, StatStrip } from '@/lib/ui';
import { Card, Empty, fmtDays, rupees } from '@/components/hr/hr-ui';

/** Payslips — `/me/payslips`. Every released month, ready to open and print. */
export default function MyPayslipsPage() {
  const [rows, setRows] = useState<PayslipSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    getMyPayslips().then(setRows).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Fetching your payslips" />;

  // India's financial year: April to March.
  const latest = rows[0]?.month;
  const fyStart = latest ? (Number(latest.slice(5)) >= 4 ? `${latest.slice(0, 4)}-04` : `${Number(latest.slice(0, 4)) - 1}-04`) : '';
  const fy = rows.filter((r) => r.month >= fyStart);
  const ytdNet = fy.reduce((a, r) => a + r.netPaise, 0);
  const ytdGross = fy.reduce((a, r) => a + r.grossPaise, 0);
  const max = Math.max(...rows.map((r) => r.grossPaise), 1);
  const chart = [...rows].slice(0, 12).reverse();

  return (
    <ModuleGuard module="me">
      <PageHeader title="Payslips" sub="Every month HR has released. Open one to read it in full, print it, or save it as a PDF." module="me" />
      {rows.length === 0 ? (
        <Card>
          <Empty emoji="🧾">No payslips yet. Each month’s appears here as soon as HR releases the payroll.</Empty>
        </Card>
      ) : (
        <Stack gap={16}>
          <StatStrip
            stats={[
              { k: 'Last take-home', emoji: '💰', v: rupees(rows[0].netPaise), note: monthLabel(rows[0].month) },
              { k: 'Take-home this financial year', emoji: '📈', v: rupees(ytdNet), note: `${fy.length} month${fy.length === 1 ? '' : 's'} since April` },
              { k: 'Earned this financial year', emoji: '🧮', v: rupees(ytdGross), note: `Deductions ${rupees(ytdGross - ytdNet)}` },
            ]}
          />
          {chart.length > 1 && (
            <Card title="Month by month" emoji="📊">
              <div className="bars" style={{ height: 150 }}>
                {chart.map((r) => (
                  <div key={r.id} title={`${monthLabel(r.month)}: take-home ${rupees(r.netPaise)}`}>
                    <span className="hr-muted" style={{ fontSize: 10.5 }}>
                      {rupees(r.netPaise).replace('₹', '₹ ')}
                    </span>
                    <div className="bars-col" style={{ height: `${Math.max(8, (r.netPaise / max) * 100)}%`, background: 'linear-gradient(180deg, var(--hr-self-b), var(--hr-self-a))' }} />
                    <span className="bars-lab">{monthLabel(r.month).slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <div className="hr-grid">
            {rows.map((r) => (
              <Link key={r.id} href={`/print/payslip/${r.id}`} target="_blank" className="hr-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="hr-card-head">
                  <div className="hr-card-title">🧾 {monthLabel(r.month)}</div>
                  <span className="hr-muted">Open ↗</span>
                </div>
                <div>
                  <div className="hr-muted">Take-home</div>
                  <div className="hr-big">{rupees(r.netPaise)}</div>
                </div>
                <div className="pay-split" aria-hidden="true">
                  <span style={{ width: `${(r.netPaise / r.grossPaise) * 100}%`, background: 'var(--hr-present)' }} />
                  <span style={{ width: `${(r.deductionsPaise / r.grossPaise) * 100}%`, background: 'var(--hr-late)' }} />
                </div>
                <div className="hr-muted">
                  Earned {rupees(r.grossPaise)} · deductions {rupees(r.deductionsPaise)} · {fmtDays(r.payableDays)} days paid
                  {r.lopDays ? ` · ${fmtDays(r.lopDays)} unpaid` : ''}
                </div>
              </Link>
            ))}
          </div>
        </Stack>
      )}
    </ModuleGuard>
  );
}
