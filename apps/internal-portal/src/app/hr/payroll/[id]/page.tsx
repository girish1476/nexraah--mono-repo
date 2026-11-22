'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { dateLabel } from '@/lib/hr/calendar';
import { RunDetail, getBankFile, getRun, runStep } from '@/lib/hr/apis';
import type { PayslipRow } from '@/lib/hr/types';
import { Banner, Column, DataTable, Dialog, ErrorState, Field, Loading, ModuleGuard, PageHeader, Stack, StatStrip, useToast } from '@/lib/ui';
import { Card, Person, download, fmtDays, rupees } from '@/components/hr/hr-ui';

/** One month's payroll — `/hr/payroll/[id]`. Review, submit, approve, release, pay. */
export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [data, setData] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'submit' | 'approve' | 'release' | 'send-back' | null>(null);
  const [note, setNote] = useState('');
  const [flagsOnly, setFlagsOnly] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getRun(id).then(setData).catch((e) => setError(errorMessage(e)));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Opening the month" />;
  const { run } = data;

  const act = async (step: 'recalculate' | 'submit' | 'approve' | 'send-back' | 'release') => {
    setBusy(true);
    try {
      await runStep(run.id, step, step === 'send-back' ? note : undefined);
      toast(
        {
          recalculate: 'Recalculated from the latest attendance',
          submit: 'Sent to Leadership for approval',
          approve: 'Approved — release the payslips and pay',
          'send-back': 'Sent back to HR with your note',
          release: 'Payslips released — everyone can see theirs in My HR',
        }[step],
      );
      setConfirm(null);
      setNote('');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const bankFile = async () => {
    try {
      const f = await getBankFile(run.id);
      download(f.filename, f.csv);
      toast('Bank file downloaded — upload it to the bank’s bulk payment screen');
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const order = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RELEASED'] as const;
  const at = order.indexOf(run.status);
  const steps = [
    { t: 'Prepared', s: run.preparedByName ? `${run.preparedByName}${run.preparedAt ? ` · ${dateLabel(run.preparedAt)}` : ''}` : 'HR calculates the month' },
    { t: 'Submitted', s: run.submittedAt ? dateLabel(run.submittedAt) : 'HR sends it for approval' },
    { t: 'Approved', s: run.approvedByName ? `${run.approvedByName} · ${dateLabel(run.approvedAt)}` : 'Leadership signs it off' },
    { t: 'Released', s: run.releasedAt ? dateLabel(run.releasedAt) : 'Payslips go out, salaries are paid' },
  ];
  const flagged = data.rows.filter((r) => r.flags.length).length;
  const rows = flagsOnly ? data.rows.filter((r) => r.flags.length) : data.rows;

  const columns: Column<PayslipRow>[] = [
    { key: 'p', label: 'Person', render: (r) => <Link href={`/hr/employees/${r.employeeId}`} style={{ color: 'inherit', textDecoration: 'none' }}><Person name={r.name} sub={`${r.code} · ${r.designation}`} size={30} /></Link> },
    { key: 'd', label: 'Days paid', align: 'right', render: (r) => <span>{fmtDays(r.payableDays)}{r.lopDays ? <span style={{ color: 'var(--red)' }}> (−{fmtDays(r.lopDays)})</span> : ''}</span> },
    { key: 'g', label: 'Earned', align: 'right', render: (r) => rupees(r.grossPaise) },
    { key: 'x', label: 'Deductions', align: 'right', render: (r) => rupees(r.deductionsPaise) },
    { key: 'n', label: 'Take-home', align: 'right', render: (r) => <strong>{rupees(r.netPaise)}</strong> },
    { key: 'f', label: 'Check', render: (r) => (r.flags.length ? <span title={r.flags.join('\n')} style={{ color: 'var(--flag)', fontWeight: 600, fontSize: 12.5 }}>⚠️ {r.flags[0]}{r.flags.length > 1 ? ` +${r.flags.length - 1}` : ''}</span> : <span className="hr-muted">✓</span>) },
    { key: 'o', label: '', render: (r) => <Link className="btn btn-secondary btn-sm" href={`/print/payslip/${r.id}`} target="_blank">Payslip</Link> },
  ];

  return (
    <ModuleGuard module="hr">
      <PageHeader title={`Payroll · ${run.label}`} sub={`${run.headcount} people`} module="hr" right={<Link href="/hr/payroll" className="btn btn-secondary btn-sm">← All months</Link>} />
      <Stack gap={16}>
        <div className="steps" aria-label="Where this month stands">
          {steps.map((s, i) => (
            <div key={s.t} className={`step${i < at || run.status === 'RELEASED' ? ' is-done' : i === at ? ' is-now' : ''}`}>
              <div>
                <span className="step-n">{i < at || run.status === 'RELEASED' ? '✓' : i + 1}</span>
                <span className="step-t">{s.t}</span>
              </div>
              <div className="step-s">{s.s}</div>
            </div>
          ))}
        </div>

        {run.sentBackNote && run.status === 'DRAFT' && (
          <Banner tone="flag" title="Sent back by Leadership">
            “{run.sentBackNote}”
          </Banner>
        )}
        {data.inProgress && run.status === 'DRAFT' && (
          <Banner tone="blue" title="This month is still running">
            Days after today are counted as worked. Recalculate on the last working day, before submitting.
          </Banner>
        )}
        {data.preparedByMe && run.status === 'SUBMITTED' && (
          <Banner tone="grey" title="Waiting for someone else">
            You prepared this month, so another person with approval rights signs it off.
          </Banner>
        )}

        <StatStrip
          stats={[
            { k: 'Take-home', emoji: '💸', v: rupees(run.netPaise), note: 'What reaches bank accounts' },
            { k: 'Gross earnings', emoji: '🧮', v: rupees(run.grossPaise) },
            { k: 'Deductions', emoji: '➖', v: rupees(run.deductionsPaise) },
            { k: 'Cost to company', emoji: '🏢', v: rupees(run.employerCostPaise), note: 'Gross plus employer PF and ESI' },
          ]}
        />

        <div className="hr-grid">
          <Card title="To pay the government" emoji="🏛️">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {(
                [
                  ['PF (both shares)', data.statutory.pf, 'EPFO, by the 15th'],
                  ['ESI (both shares)', data.statutory.esi, 'ESIC, by the 15th'],
                  ['Professional tax', data.statutory.pt, 'State, monthly'],
                  ['TDS on salaries', data.statutory.tds, 'Income tax, by the 7th'],
                ] as [string, number, string][]
              ).map(([k, v, s]) => (
                <div key={k}>
                  <div className="hr-muted">{k}</div>
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{rupees(v)}</div>
                  <div className="hr-muted" style={{ fontSize: 11 }}>
                    {s}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Next step" emoji="👉">
            {run.status === 'DRAFT' && data.canPrepare && (
              <>
                <div className="hr-muted">Check the people flagged below, then send the month for approval.</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn" disabled={busy} onClick={() => setConfirm('submit')}>
                    Submit for approval
                  </button>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => void act('recalculate')}>
                    ↻ Recalculate
                  </button>
                </div>
              </>
            )}
            {run.status === 'SUBMITTED' &&
              (data.canApprove ? (
                <>
                  <div className="hr-muted">Look over the totals and the flags, then approve — or send it back with what to fix.</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn" disabled={busy} onClick={() => setConfirm('approve')}>
                      ✓ Approve {run.label.split(' ')[0]}
                    </button>
                    <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm('send-back')}>
                      Send back
                    </button>
                  </div>
                </>
              ) : (
                <div className="hr-muted">Waiting for Leadership to approve.</div>
              ))}
            {run.status === 'APPROVED' && (
              <>
                <div className="hr-muted">Download the bank file and pay, then release the payslips so everyone can see theirs.</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary" onClick={() => void bankFile()}>
                    ⬇️ Bank file
                  </button>
                  {(data.canPrepare || data.canApprove || data.preparedByMe) && (
                    <button className="btn" disabled={busy} onClick={() => setConfirm('release')}>
                      Release payslips
                    </button>
                  )}
                </div>
              </>
            )}
            {run.status === 'RELEASED' && (
              <>
                <div className="hr-muted">Paid and released {dateLabel(run.releasedAt)}. Everyone sees their payslip in My HR.</div>
                <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => void bankFile()}>
                  ⬇️ Bank file again
                </button>
              </>
            )}
            {data.unbanked > 0 && (
              <div style={{ color: 'var(--flag)', fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                ⚠️ {data.unbanked} {data.unbanked === 1 ? 'person has' : 'people have'} no bank account — they are left out of the bank file and need paying another way.
              </div>
            )}
          </Card>
        </div>

        <Card
          title="Everyone this month"
          emoji="👥"
          right={
            flagged > 0 && (
              <button className={`btn btn-sm ${flagsOnly ? '' : 'btn-secondary'}`} onClick={() => setFlagsOnly(!flagsOnly)}>
                ⚠️ {flagged} to check
              </button>
            )
          }
        >
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        </Card>
      </Stack>

      <Dialog
        open={confirm !== null && confirm !== 'send-back'}
        title={confirm === 'submit' ? `Submit ${run.label}?` : confirm === 'approve' ? `Approve ${run.label}?` : `Release ${run.label}’s payslips?`}
        body={
          confirm === 'submit'
            ? `It is recalculated one last time and locked. Leadership then approves ${rupees(run.netPaise)} of take-home for ${run.headcount} people.`
            : confirm === 'approve'
              ? `${rupees(run.netPaise)} to ${run.headcount} people, ${rupees(run.employerCostPaise)} cost to company. After this the bank file can be downloaded.`
              : 'Everyone on this payroll sees their payslip in My HR straight away.'
        }
        confirmLabel={confirm === 'submit' ? 'Submit' : confirm === 'approve' ? 'Approve' : 'Release'}
        busy={busy}
        onConfirm={() => confirm && void act(confirm)}
        onClose={() => setConfirm(null)}
      />
      <Dialog
        open={confirm === 'send-back'}
        title="Send back to HR"
        body="It goes back to a draft. Say what needs fixing."
        confirmLabel="Send back"
        confirmDisabled={note.trim().length < 5}
        busy={busy}
        onConfirm={() => void act('send-back')}
        onClose={() => setConfirm(null)}
      >
        <Field label="What to fix">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Kiran’s unpaid days look wrong — check the 16th" autoFocus />
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}
