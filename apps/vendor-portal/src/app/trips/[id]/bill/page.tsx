'use client';

import { useEffect, useState } from 'react';
import { ActionBar, Callout, ErrorNote, Loading, ScreenHeader, TabBar } from '@/components/shell';
import { inr } from '@/lib/format';
import { getBillDraft, submitBill } from '../../apis';
import { BillDraft, BillResult } from '../../types';

const today = () => new Date().toISOString().slice(0, 10);

export default function BillPage({ params }: { params: { id: string } }) {
  const [draft, setDraft] = useState<BillDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BillResult | null>(null);
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(today());
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getBillDraft(params.id)
      .then(setDraft)
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (!draft) {
    return (
      <main className="screen">
        <ScreenHeader title="Raise your bill" back={params.id} />
        {error ? <ErrorNote message={error} /> : <Loading />}
        <TabBar />
      </main>
    );
  }

  if (result) {
    return (
      <main className="screen">
        <ScreenHeader title="Bill received" back={params.id} />
        <Callout tone="mint" title={`Bill ${result.billNo} received`}>
          We compute {inr(result.computedBalancePaise)} against your {inr(result.billedPaise)}.
          {result.variancePaise !== 0 &&
            ` Finance will review the ${inr(Math.abs(result.variancePaise))} difference before releasing.`}
        </Callout>
        <TabBar />
      </main>
    );
  }

  const valid = draft.submittable && billNo.trim() !== '' && billDate <= today() && !!file;

  const submit = () => {
    if (!valid || !file) return;
    setSending(true);
    submitBill(params.id, { billNo: billNo.trim(), billDate, file })
      .then(setResult)
      .catch((e) => {
        setError(e.message);
        setSending(false);
      });
  };

  return (
    <main className="screen">
      <ScreenHeader
        title="Raise your bill"
        sub="Your bill to us — not our invoice to the client"
        back={params.id}
      />

      {error && <ErrorNote message={error} />}

      {!draft.submittable && (
        <Callout tone="flag" title="Not yet submittable">
          <ul style={{ marginTop: 4, listStyle: 'none' }}>
            {draft.conditions.map((c) => (
              <li key={c.label} style={{ fontSize: 14, padding: '2px 0' }}>
                {c.met ? '✓' : '✗'} {c.label}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="card">
        <p className="card-title" style={{ marginBottom: 8 }}>
          Amounts — computed, not editable
        </p>
        {[
          ['Freight', inr(draft.freightPaise)],
          ['Agreed charges', inr(draft.agreedChargesPaise)],
          ['Bill total', inr(draft.billTotalPaise)],
        ].map(([k, v], i) => (
          <div
            key={k}
            className="row-between"
            style={{ padding: '8px 0', borderTop: i ? '1px solid var(--color-divider)' : 'none' }}
          >
            <span className="muted">{k}</span>
            <span style={{ fontWeight: i === 2 ? 700 : 500 }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Declaration sits on the form, beside the number being typed. */}
      <Callout tone="blue" title="TAX PAYABLE UNDER REVERSE CHARGE">
        Do not add GST to this bill. Nexraah accounts for the tax under the reverse charge
        mechanism.
      </Callout>

      <div className="card">
        <label className="muted" htmlFor="billNo">
          Your bill number
        </label>
        <input
          id="billNo"
          className="field"
          style={{ marginTop: 6, fontFamily: 'ui-monospace, Menlo, monospace' }}
          value={billNo}
          disabled={!draft.submittable}
          onChange={(e) => setBillNo(e.target.value)}
        />
      </div>

      <div className="card">
        <label className="muted" htmlFor="billDate">
          Bill date
        </label>
        <input
          id="billDate"
          className="field"
          style={{ marginTop: 6 }}
          type="date"
          max={today()}
          value={billDate}
          disabled={!draft.submittable}
          onChange={(e) => setBillDate(e.target.value)}
        />
      </div>

      <div className="card">
        <label className="muted" htmlFor="billFile">
          Attach your bill copy
        </label>
        <input
          id="billFile"
          className="field"
          style={{ marginTop: 6 }}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          disabled={!draft.submittable}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <p className="muted">
        Billing more than we compute does not reject the bill. Finance reviews the difference —
        a detention charge or an extra halt may well be yours to claim.
      </p>

      <ActionBar
        label={sending ? 'Sending…' : 'Submit bill'}
        disabled={!valid || sending}
        note={
          !draft.submittable
            ? 'Proof of delivery must be approved first'
            : !file
              ? 'Attach a copy of your bill'
              : undefined
        }
        onClick={submit}
      />

      <TabBar />
    </main>
  );
}
