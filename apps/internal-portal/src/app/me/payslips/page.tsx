'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { monthLabel } from '@/lib/hr/calendar';
import { PayslipSummary, getMyPayslips } from '@/lib/hr/apis';
import { ErrorState, Loading, ModuleGuard, PageHeader, Stack, StatStrip } from '@/lib/ui';
import { Card, Empty, fmtDays, rupees } from '@/components/hr/hr-ui';
import { PayslipDownload } from '@/components/hr/payslip-download';

/**
 * Payslips — `/me/payslips`. Every released month, newest first, each one a
 * Nexraah payslip PDF to download. The totals for the financial year sit below.
 */
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

  return (
    <ModuleGuard module="me">
      <PageHeader title="Payslips" sub="Your payslip for every month HR has released — download each one as a PDF." module="me" />
      {rows.length === 0 ? (
        <Card>
          <Empty emoji="🧾">No payslips yet. Each month’s appears here as soon as HR releases the payroll.</Empty>
        </Card>
      ) : (
        <Stack gap={16}>
          <Card title="Month by month" emoji="🧾">
            <div className="slip-list" role="list">
              {rows.map((r) => (
                <div key={r.id} className="slip-list-row" role="listitem" data-payslip-month={r.month}>
                  <div className="slip-list-month">
                    <div className="slip-list-title">{monthLabel(r.month)}</div>
                    <div className="hr-muted">
                      {fmtDays(r.payableDays)} days paid{r.lopDays ? ` · ${fmtDays(r.lopDays)} unpaid` : ''}
                    </div>
                  </div>
                  <div className="slip-list-figs">
                    <div>
                      <div className="hr-muted">Earned</div>
                      <div>{rupees(r.grossPaise)}</div>
                    </div>
                    <div>
                      <div className="hr-muted">Deductions</div>
                      <div>{rupees(r.deductionsPaise)}</div>
                    </div>
                    <div>
                      <div className="hr-muted">Take-home</div>
                      <strong>{rupees(r.netPaise)}</strong>
                    </div>
                  </div>
                  <div className="slip-list-actions">
                    <PayslipDownload id={r.id} />
                    <Link href={`/print/payslip/${r.id}`} target="_blank" className="btn btn-secondary btn-sm">
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <StatStrip
            stats={[
              { k: 'Last take-home', emoji: '💰', v: rupees(rows[0].netPaise), note: monthLabel(rows[0].month) },
              { k: 'Take-home this financial year', emoji: '📈', v: rupees(ytdNet), note: `${fy.length} month${fy.length === 1 ? '' : 's'} since April` },
              { k: 'Earned this financial year', emoji: '🧮', v: rupees(ytdGross), note: `Deductions ${rupees(ytdGross - ytdNet)}` },
            ]}
          />
        </Stack>
      )}
    </ModuleGuard>
  );
}
