'use client';

import '@/components/hr/hr.css';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { getConfig } from '@/app/admin/apis';
import type { Config } from '@/app/admin/types';
import { dateLabel, monthLabel } from '@/lib/hr/calendar';
import { getPayslip } from '@/lib/hr/apis';
import type { PayLine, Payslip } from '@/lib/hr/types';
import { amountInWords } from '@/lib/manual-invoice';
import { ErrorState, Loading } from '@/lib/ui';
import { PayslipDownload } from '@/components/hr/payslip-download';

/**
 * A payslip — `/print/payslip/[id]`. One A4 page: who, which month, the days
 * paid, earnings beside deductions, and the take-home in figures and words.
 * The person opens their own; payroll can open anyone's. Print, or save as
 * PDF from the print dialog.
 */
export default function PrintPayslipPage() {
  const { id } = useParams<{ id: string }>();
  const [slip, setSlip] = useState<(Payslip & { label: string }) | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getPayslip(id), getConfig().catch(() => null)])
      .then(([s, c]) => {
        setSlip(s);
        setConfig(c);
        document.title = `Payslip ${monthLabel(s.month)} — ${s.employee.name}`;
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  if (error) return <ErrorState message={error} />;
  if (!slip) return <Loading what="Preparing the payslip" />;

  const co = config?.company;
  const amt = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rows = Math.max(slip.earnings.length, slip.deductions.length);
  const pad = (lines: PayLine[]) => [...lines, ...Array.from({ length: rows - lines.length }, () => null)];
  const employerTotal = slip.employer.reduce((a, l) => a + l.amountPaise, 0);

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100vh', padding: '20px 14px 40px' }}>
      <div className="no-print" style={{ maxWidth: 820, margin: '0 auto 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <PayslipDownload id={slip.id} className="btn" />
        <button className="btn btn-secondary" onClick={() => window.print()}>
          🖨️ Print
        </button>
      </div>

      <article className="slip" aria-label={`Payslip for ${slip.label}`}>
        <header className="slip-head">
          <div className="slip-co">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/nexraah-logo-print.png" alt="" />
            <div>
              <div className="slip-co-name">{co?.name ?? 'Nexraah'}</div>
              {co?.address && <div className="slip-co-sub">{co.address}</div>}
            </div>
          </div>
          <div className="slip-title">
            <div className="slip-title-k">Payslip</div>
            <div className="slip-title-v">{monthLabel(slip.month)}</div>
          </div>
        </header>

        <div className="slip-body">
          <section className="slip-who" aria-label="Employee">
            {(
              [
                ['Employee', slip.employee.name],
                ['Employee code', slip.employee.code],
                ['Designation', slip.employee.designation],
                ['Department', slip.employee.department],
                ['Branch', slip.employee.branchName],
                ['Date of joining', dateLabel(slip.employee.joinedOn)],
                ['PAN', slip.employee.pan ?? '—'],
                ['PF UAN', slip.employee.uan ?? '—'],
                ['Bank', slip.employee.bankName ?? 'Not on file'],
                ['Account', slip.employee.accountNo ?? '—'],
                ['IFSC', slip.employee.ifsc ?? '—'],
                ['ESI number', slip.employee.esicNo ?? '—'],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k}>
                <div className="slip-k">{k}</div>
                <div className="slip-v">{v}</div>
              </div>
            ))}
          </section>

          <section className="slip-days" aria-label="Days">
            {(
              [
                ['Days in month', slip.days.inMonth],
                ['Days paid', slip.days.payable],
                ['Unpaid days', slip.days.lop],
                ['Leave taken', slip.days.leave],
                ['Holidays & offs', slip.days.holidays + slip.days.weeklyOffs],
              ] as [string, number][]
            ).map(([k, v]) => (
              <div key={k}>
                <div className="slip-k">{k}</div>
                <div className="slip-v">{Number.isInteger(v) ? v : v.toFixed(1)}</div>
              </div>
            ))}
          </section>

          <section className="slip-tables">
            <table className="slip-table">
              <thead>
                <tr>
                  <th>Earnings</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {pad(slip.earnings).map((l, i) => (
                  <tr key={i}>
                    <td>{l?.label ?? ' '}</td>
                    <td>{l ? amt(l.amountPaise) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Gross earnings</td>
                  <td>{amt(slip.grossPaise)}</td>
                </tr>
              </tfoot>
            </table>
            <table className="slip-table">
              <thead>
                <tr>
                  <th>Deductions</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {pad(slip.deductions).map((l, i) => (
                  <tr key={i}>
                    <td>{l?.label ?? ' '}</td>
                    <td>{l ? amt(l.amountPaise) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total deductions</td>
                  <td>{amt(slip.deductionsPaise)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <section className="slip-net" aria-label="Take-home pay">
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.8 }}>Net pay for {monthLabel(slip.month)}</div>
              <div style={{ marginTop: 4, fontSize: 13, opacity: 0.92 }}>{amountInWords(slip.netPaise)}</div>
            </div>
            <div className="slip-net-v">{amt(slip.netPaise)}</div>
          </section>

          {slip.employer.length > 0 && (
            <div style={{ fontSize: 12, color: '#3c4760' }}>
              <strong>Paid by the company on top of your salary:</strong>{' '}
              {slip.employer.map((l) => `${l.label} ${amt(l.amountPaise)}`).join(' · ')} — {amt(employerTotal)} in all.
            </div>
          )}

          <footer className="slip-foot">
            This payslip is computer-generated and needs no signature. Unpaid days are absences, unpaid leave and half of
            each half day. For any question about it, write to HR{co?.email ? ` at ${co.email}` : ''}.
          </footer>
        </div>
      </article>
    </div>
  );
}
