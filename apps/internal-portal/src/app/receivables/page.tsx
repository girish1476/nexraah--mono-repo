'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage, newIdempotencyKey } from '@/apis';
import { getReceivables, recordReceipt } from '@/app/invoices/apis';
import { AgeingBucket, ReceivablesResponse, ReceivablesRow } from '@/app/invoices/types';
import { PAYMENT_MODES } from '@/lib/documents';
import { fmtDate, inr } from '@/lib/format';
import {
  Column,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  FormGrid,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  StatStrip,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';

const BUCKET_LABEL: Record<AgeingBucket, string> = {
  CURRENT: 'Not yet due',
  D0_30: '0–30 days',
  D31_60: '31–60 days',
  D61_90: '61–90 days',
  D90_PLUS: '90+ days',
};

const BUCKET_TONE: Record<AgeingBucket, Tone> = {
  CURRENT: 'grey',
  D0_30: 'blue',
  D31_60: 'flag',
  D61_90: 'flag',
  D90_PLUS: 'red',
};

/**
 * Receivables — `/receivables` · `receipt.record` (part 08 §3).
 *
 * A receipt equal to or greater than the balance closes the invoice; any
 * lesser amount part-pays it and the remainder stays in the ageing (BR-16).
 */
export default function ReceivablesPage() {
  const can = useCan();
  const toast = useToast();
  const [data, setData] = useState<ReceivablesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipting, setReceipting] = useState<ReceivablesRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    amountRupees: 0,
    receivedOn: new Date().toISOString().slice(0, 10),
    mode: 'NEFT',
    reference: '',
    remarks: '',
  });

  const load = () => {
    setError(null);
    getReceivables().then(setData).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const open = (row: ReceivablesRow) => {
    setReceipting(row);
    setForm((f) => ({ ...f, amountRupees: row.balancePaise / 100 }));
  };

  const submit = async () => {
    if (!receipting) return;
    setBusy(true);
    try {
      const receipt = await recordReceipt(newIdempotencyKey(), {
        invoiceId: receipting.invoiceId,
        amountPaise: Math.round(form.amountRupees * 100),
        receivedOn: form.receivedOn,
        mode: form.mode,
        reference: form.reference,
        remarks: form.remarks,
      });
      const full = Math.round(form.amountRupees * 100) >= receipting.balancePaise;
      toast(`${receipt.code} recorded · invoice ${full ? 'closed' : 'part-paid, balance stays in the ageing'}`);
      setReceipting(null);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading receivables" />;

  const columns: Column<ReceivablesRow>[] = [
    {
      key: 'invoice',
      label: 'Bill',
      render: (r) => (
        <Link href={`/invoices/${r.invoiceId}`} className="mono" style={{ fontSize: 12 }}>
          {r.invoiceCode ?? 'draft'}
        </Link>
      ),
    },
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    { key: 'date', label: 'Raised on', render: (r) => fmtDate(r.invoiceDate) },
    { key: 'due', label: 'Due by', render: (r) => fmtDate(r.dueDate) },
    { key: 'total', label: 'Bill amount', align: 'right', render: (r) => inr(r.totalPaise) },
    { key: 'received', label: 'Paid so far', align: 'right', render: (r) => inr(r.receivedPaise) },
    { key: 'balance', label: 'Still owed', align: 'right', render: (r) => inr(r.balancePaise) },
    { key: 'bucket', label: 'How overdue', render: (r) => <Tag tone={BUCKET_TONE[r.bucket]}>{BUCKET_LABEL[r.bucket]}</Tag> },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) =>
        can('receipt.record') ? (
          <button className="btn btn-sm" onClick={() => open(r)}>
            Record receipt
          </button>
        ) : null,
    },
  ];

  return (
    <ModuleGuard module="receivables">
      <PageHeader path="/receivables" title="Receivables" module="receivables" />
      <PageIntro
        what="Money your clients still owe you, grouped by how overdue it is."
        who="Finance chases these and records the payments as they come in."
      >
        The oldest buckets are the ones at real risk. When a client pays, record the receipt against
        their invoice so the balance here comes down.
      </PageIntro>

      <Stack>
        <StatStrip
          stats={data.buckets.map((b) => ({
            k: BUCKET_LABEL[b.bucket],
            v: inr(b.amountPaise),
            note: `${b.count} invoice${b.count === 1 ? '' : 's'}`,
            tone: BUCKET_TONE[b.bucket],
          }))}
        />

        <Panel pad={false}>
          <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.invoiceId} empty="Nothing outstanding." />
        </Panel>

        <Panel title="Recent receipts" pad={false}>
          <DataTable
            columns={[
              { key: 'code', label: 'Receipt', mono: true, render: (r) => r.code },
              { key: 'invoice', label: 'Bill', mono: true, render: (r) => r.invoiceCode ?? '—' },
              { key: 'client', label: 'Client', render: (r) => r.clientName },
              { key: 'when', label: 'Paid so far', render: (r) => fmtDate(r.receivedOn) },
              { key: 'mode', label: 'Paid by', render: (r) => r.mode },
              { key: 'ref', label: 'Reference number', mono: true, render: (r) => r.reference },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amountPaise) },
            ]}
            rows={data.receipts}
            rowKey={(r) => r.id}
            empty="No receipts recorded."
          />
        </Panel>
      </Stack>

      <Dialog
        open={!!receipting}
        title="Record a receipt"
        facts={
          receipting
            ? [
                ['Invoice', receipting.invoiceCode ?? '—'],
                ['Client', receipting.clientName],
                ['Balance', inr(receipting.balancePaise)],
              ]
            : []
        }
        confirmLabel="Record receipt"
        confirmDisabled={!form.reference.trim() || form.amountRupees <= 0}
        busy={busy}
        onConfirm={submit}
        onClose={() => setReceipting(null)}
      >
        <FormGrid>
          <Field
            label="Amount (₹)"
            required
            hint={receipting ? `Cannot exceed ${inr(receipting.balancePaise)}` : undefined}
          >
            <input
              type="number"
              value={form.amountRupees || ''}
              onChange={(e) => setForm({ ...form, amountRupees: Number(e.target.value) })}
            />
          </Field>
          <Field label="Received on" required>
            <input type="date" value={form.receivedOn} onChange={(e) => setForm({ ...form, receivedOn: e.target.value })} />
          </Field>
          <Field label="Mode" required>
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="UTR or cheque number" required>
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </Field>
          <Field label="Remarks">
            <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </Field>
        </FormGrid>
      </Dialog>
    </ModuleGuard>
  );
}
