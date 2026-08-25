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
        <ScreenHeader
          title="Bill received"
          what="Your bill is with us. Nothing more is needed from you on this trip."
          back={params.id}
        />
        <Callout tone="mint" title={`Bill ${result.billNo} received`}>
          We compute {inr(result.computedBalancePaise)} against your {inr(result.billedPaise)}.
          {result.variancePaise !== 0 &&
            ` Finance will review the ${inr(Math.abs(result.variancePaise))} difference before releasing.`}
          {result.variancePaise !== 0 && (
            <p style={{ marginTop: 8 }}>
              A difference is not a problem and nothing has been rejected. Someone will look at the
              two figures and pay what is due — you do not have to send the bill again.
            </p>
          )}
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
        sub={`${params.id} · your own bill to Nexraah`}
        what="Send us your own bill for the balance on this trip. We have already worked out the amount — you only add your bill number and a photo of the bill."
        back={params.id}
      />

      {error && <ErrorNote message={error} />}

      {!draft.submittable && (
        <Callout tone="flag" title="Not yet submittable">
          <p>
            You can send a bill for this trip only after both of these are done. There is nothing
            wrong with your bill — the trip is simply not ready yet.
          </p>
          <ul style={{ marginTop: 8, listStyle: 'none' }}>
            {draft.conditions.map((c) => (
              <li key={c.label} style={{ fontSize: 15, padding: '3px 0' }}>
                {c.met ? '✓' : '✗'} {c.label}
                <span className="muted" style={{ display: 'block' }}>
                  {c.met ? 'Done' : 'Still waiting'}
                </span>
              </li>
            ))}
          </ul>
          <p style={{ marginTop: 8 }}>
            The boxes below stay locked until both lines show a tick.
          </p>
        </Callout>
      )}

      <div className="card">
        <p className="card-title" style={{ marginBottom: 2 }}>
          What to bill us for
        </p>
        <p className="muted" style={{ marginBottom: 8 }}>
          These come from the trip itself, so they cannot be edited here. Write the last figure on
          your bill.
        </p>
        {[
          ['Freight agreed', inr(draft.freightPaise)],
          ['Extra charges already agreed', inr(draft.agreedChargesPaise)],
          ['Bill for this amount', inr(draft.billTotalPaise)],
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
        <p style={{ fontWeight: 600 }}>Do not add GST to this bill.</p>
        <p style={{ marginTop: 6 }}>
          Nexraah accounts for the tax under the reverse charge mechanism — in plain words, we pay
          the GST on this trip to the government, not you. Your bill should show the amount above
          and no tax line.
        </p>
      </Callout>

      <div className="card">
        <label className="muted" htmlFor="billNo">
          Your bill number — from your own bill book, in whatever format you use
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
          The date written on your bill — today or any day before it
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
          A photo or PDF of the bill itself — the same one you keep in your book
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
        If your bill comes to more than the figure above, send it anyway — it is not rejected for
        that. Someone checks the difference, and a detention charge or an extra halt may well be
        yours to claim.
      </p>

      <ActionBar
        label={sending ? 'Sending…' : 'Submit bill'}
        disabled={!valid || sending}
        note={
          !draft.submittable
            ? 'Proof of delivery must be approved first — see the checklist at the top'
            : !file
              ? 'Attach a photo of your bill to send it'
              : undefined
        }
        onClick={submit}
      />

      <TabBar />
    </main>
  );
}
