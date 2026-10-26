'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import {
  StatementUnreadable,
  checkAgainstStatement,
  readStatement,
  type BankCheck,
  type PaymentToCheck,
  type StatementLine,
} from '@/lib/accounting';
import { fmtDate, inr } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  StatStrip,
} from '@/lib/ui';
import { listReleasedPayments } from '../apis';

/**
 * Bank statement check — `/payments/bank-check`.
 *
 * The banking integration's first half (FSD B7, part 13 §2(a)): every payment
 * released to a transporter carries a UTR keyed by hand (BR-09), and a
 * mis-keyed UTR is the failure that actually happens. Finance opens the
 * bank's statement here; each payment's UTR is looked for in it. The
 * statement is read in this browser and goes nowhere else.
 */
export default function BankCheckPage() {
  const [payments, setPayments] = useState<PaymentToCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<BankCheck | null>(null);

  const load = () => {
    setError(null);
    listReleasedPayments()
      .then(setPayments)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const open = async (picked: File | undefined) => {
    if (!picked || !payments) return;
    setProblem(null);
    setResult(null);
    setFile(picked.name);
    if (!/\.csv$/i.test(picked.name) && picked.type !== 'text/csv') {
      setProblem('Save the statement as CSV from the bank’s website (most offer "Download as CSV" or Excel → Save as CSV), then open that.');
      return;
    }
    try {
      const lines = readStatement(await picked.text());
      setResult(checkAgainstStatement(payments, lines));
    } catch (e) {
      setProblem(e instanceof StatementUnreadable ? e.message : 'The file could not be read as a statement.');
    }
  };

  const who = (p: PaymentToCheck) => `${p.kind === 'ADVANCE' ? 'Advance' : 'Balance'} · ${p.tripCode ?? '—'}`;
  const paymentColumns: Column<PaymentToCheck>[] = [
    { key: 'what', label: 'Payment', primary: true, render: who, sub: (p) => p.vendorName },
    { key: 'utr', label: 'UTR keyed', mono: true, render: (p) => p.utr ?? '—' },
    { key: 'date', label: 'Value date', render: (p) => fmtDate(p.valueDate) },
    { key: 'amount', label: 'Amount', align: 'right', render: (p) => inr(p.netPaise) },
  ];
  const pairColumns: Column<{ payment: PaymentToCheck; line: StatementLine }>[] = [
    { key: 'what', label: 'Payment', primary: true, render: (m) => who(m.payment), sub: (m) => m.payment.vendorName },
    { key: 'utr', label: 'UTR', mono: true, render: (m) => m.payment.utr },
    { key: 'paid', label: 'Released here', align: 'right', render: (m) => inr(m.payment.netPaise) },
    { key: 'bank', label: 'Left the bank', align: 'right', render: (m) => inr(m.line.debitPaise) },
    { key: 'line', label: 'Statement line', render: (m) => `Row ${m.line.row} · ${fmtDate(m.line.date)}` },
  ];
  const lineColumns: Column<StatementLine>[] = [
    { key: 'row', label: 'Row', align: 'right', render: (l) => l.row },
    { key: 'date', label: 'Date', render: (l) => fmtDate(l.date) },
    { key: 'text', label: 'Description', render: (l) => l.text },
    { key: 'amount', label: 'Out', align: 'right', render: (l) => inr(l.debitPaise) },
  ];

  return (
    <ModuleGuard module="payments">
      <PageHeader
        title="Bank statement check"
        sub="Every payment released to a transporter, found — or not — in the bank's own statement."
        module="payments"
      />
      <PageIntro
        what="A UTR keyed wrong looks exactly like a right one until somebody asks the bank. Open the statement for the account the payments go out of; every released payment's UTR is looked for in it."
        who="Finance. The statement is read here, in this browser — it is not uploaded or kept."
      />

      {error && <ErrorState message={error} retry={load} />}
      {!payments && !error && <Loading what="Loading released payments" />}
      {payments && (
        <Stack>
          <Panel title="🏦 Open the statement">
            <p className="muted" style={{ marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
              A CSV as the bank gives it. It needs a description column (Narration, Description or Particulars) and a
              money-out column (Withdrawal or Debit — or an Amount column with Dr/Cr beside it).{' '}
              {payments.length} payment{payments.length === 1 ? '' : 's'} released here to check.
            </p>
            <input type="file" accept=".csv,text/csv" aria-label="Bank statement as CSV" onChange={(e) => open(e.target.files?.[0])} />
          </Panel>

          {problem && (
            <Banner tone="flag" title={`${file ?? 'That file'} could not be checked`}>
              {problem}
            </Banner>
          )}

          {result && (
            <>
              <StatStrip
                stats={[
                  { k: 'Found, same amount', emoji: '✅', v: String(result.matched.length), tone: 'mint' },
                  {
                    k: 'Found, different amount',
                    emoji: '⚠️',
                    v: String(result.amountDiffers.length),
                    tone: result.amountDiffers.length ? 'red' : undefined,
                  },
                  {
                    k: 'UTR not in the statement',
                    emoji: '🔎',
                    v: String(result.notFound.length),
                    tone: result.notFound.length ? 'red' : undefined,
                  },
                  { k: 'Other money out', emoji: '📤', v: String(result.notInConsole.length) },
                ]}
              />
              {result.period && (
                <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                  {file} covers {fmtDate(result.period.from)} to {fmtDate(result.period.to)}.
                  {result.outside.length > 0 &&
                    ` ${result.outside.length} payment${result.outside.length === 1 ? ' was' : 's were'} made outside those days and ${result.outside.length === 1 ? 'is' : 'are'} not judged by it.`}
                </p>
              )}

              {result.notFound.length > 0 && (
                <Panel title="🔎 UTR not in the statement — check these first" pad={false}>
                  <DataTable columns={paymentColumns} rows={result.notFound} rowKey={(p) => p.id} />
                  <div className="muted" style={{ fontSize: 12, padding: '10px 14px', lineHeight: 1.45 }}>
                    Paid within the statement&apos;s dates, but the bank shows no payment with this UTR. Most often a digit was
                    keyed wrong; sometimes the payment went from another account. Compare with the bank&apos;s advice.
                  </div>
                </Panel>
              )}
              {result.amountDiffers.length > 0 && (
                <Panel title="⚠️ Found, but a different amount left the bank" pad={false}>
                  <DataTable columns={pairColumns} rows={result.amountDiffers} rowKey={(m) => m.payment.id} />
                </Panel>
              )}
              {result.matched.length > 0 && (
                <Panel title="✅ Found, same amount" pad={false}>
                  <DataTable columns={pairColumns} rows={result.matched} rowKey={(m) => m.payment.id} />
                </Panel>
              )}
              {result.notInConsole.length > 0 && (
                <Panel title="📤 Other money out of the account" pad={false}>
                  <DataTable columns={lineColumns} rows={result.notInConsole.slice(0, 200)} rowKey={(l) => String(l.row)} />
                  <div className="muted" style={{ fontSize: 12, padding: '10px 14px', lineHeight: 1.45 }}>
                    Money out that no payment released here accounts for — rent, salaries and the like, or a transporter paid
                    without the payment being recorded here.
                    {result.notInConsole.length > 200 && ' The first 200 are shown.'}
                  </div>
                </Panel>
              )}
            </>
          )}
        </Stack>
      )}
    </ModuleGuard>
  );
}
