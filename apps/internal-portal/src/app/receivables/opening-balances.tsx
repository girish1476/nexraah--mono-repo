'use client';

import { useEffect, useState } from 'react';
import { errorMessage, request } from '@/apis';
import { fmtDate, fmtDateTime, inr } from '@/lib/format';
import { Column, DataTable, Dialog, Field, Panel, Tag, useCan, useToast } from '@/lib/ui';

/** One balance carried in by the go-live import (`GET /opening-balances`). */
export interface OpeningBalance {
  id: string;
  kind: 'ADVANCE' | 'UNBILLED' | 'INVOICE';
  reference: string;
  partyType: 'CLIENT' | 'VENDOR';
  partyId: string;
  partyName: string;
  amountPaise: number;
  dated: string;
  ageDays: number;
  status: 'OPEN' | 'SETTLED';
  settledAt: string | null;
  settledBy: string | null;
  settledNote: string | null;
}

const KIND_LABEL: Record<OpeningBalance['kind'], string> = {
  INVOICE: 'Open invoice',
  UNBILLED: 'Trip not yet billed',
  ADVANCE: 'Advance with a transporter',
};

/**
 * What was owed on the day Nexraah took over (part 12, the third import set).
 * Shown only once an opening-balance file has been committed. These are not
 * Nexraah invoices or trips, so they are listed apart from the ageing above
 * and are closed with a note saying how — not with a receipt.
 */
export function OpeningBalances() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<OpeningBalance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState<OpeningBalance | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    request<OpeningBalance[]>({ url: '/opening-balances', method: 'GET' })
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const settle = async () => {
    if (!settling) return;
    setBusy(true);
    try {
      await request({ url: `/opening-balances/${settling.id}/settle`, method: 'POST', data: { note: note.trim() } });
      toast(`${KIND_LABEL[settling.kind]} ${settling.reference} marked settled`);
      setSettling(null);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Panel title="Carried in at go-live">
        <p className="muted" style={{ margin: 0 }}>
          Could not load opening balances: {error}
        </p>
      </Panel>
    );
  }
  if (!rows || rows.length === 0) return null;

  const open = rows.filter((r) => r.status === 'OPEN');
  const owed = (kind: OpeningBalance['kind']) =>
    open.filter((r) => r.kind === kind).reduce((sum, r) => sum + r.amountPaise, 0);
  const mayClose = (r: OpeningBalance) => can(r.kind === 'ADVANCE' ? 'payment.release' : 'receipt.record');

  const columns: Column<OpeningBalance>[] = [
    { key: 'kind', label: 'What', render: (r) => KIND_LABEL[r.kind] },
    { key: 'ref', label: 'Old reference', mono: true, render: (r) => r.reference },
    { key: 'party', label: 'Owed by / held by', render: (r) => r.partyName },
    { key: 'dated', label: 'Dated', render: (r) => fmtDate(r.dated) },
    { key: 'age', label: 'Age', align: 'right', render: (r) => `${r.ageDays} day${r.ageDays === 1 ? '' : 's'}` },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => inr(r.amountPaise) },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        r.status === 'OPEN' ? (
          <Tag tone="flag">Open</Tag>
        ) : (
          <span title={r.settledNote ?? undefined}>
            <Tag tone="mint">Settled</Tag>
            <span className="muted" style={{ fontSize: 11.5, display: 'block', marginTop: 2 }}>
              {[r.settledBy, fmtDateTime(r.settledAt)].filter(Boolean).join(' · ')}
            </span>
          </span>
        ),
    },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) =>
        r.status === 'OPEN' && mayClose(r) ? (
          <button
            className="btn btn-sm"
            onClick={() => {
              setNote('');
              setSettling(r);
            }}
          >
            Mark settled
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <Panel
        title="Carried in at go-live"
        right={<Tag tone={open.length ? 'flag' : 'mint'}>{open.length ? `${open.length} still open` : 'All settled'}</Tag>}
        pad={false}
      >
        <div className="muted" style={{ fontSize: 12.5, padding: '10px 14px' }}>
          Balances from before Nexraah, brought in by the opening-balance import. Still open: clients owe{' '}
          {inr(owed('INVOICE'))} on old invoices and {inr(owed('UNBILLED'))} on trips not yet billed; transporters hold{' '}
          {inr(owed('ADVANCE'))} in advances not yet adjusted.
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="Nothing carried in." />
      </Panel>

      <Dialog
        open={!!settling}
        title="Mark an opening balance settled"
        facts={
          settling
            ? [
                ['What', KIND_LABEL[settling.kind]],
                ['Old reference', settling.reference],
                [settling.partyType === 'VENDOR' ? 'Transporter' : 'Client', settling.partyName],
                ['Amount', inr(settling.amountPaise)],
              ]
            : []
        }
        confirmLabel="Mark settled"
        confirmDisabled={note.trim().length < 5}
        busy={busy}
        onConfirm={settle}
        onClose={() => setSettling(null)}
      >
        <Field
          label="How it was settled"
          required
          hint="The receipt, cheque or UTR number, or the trip it was adjusted against."
        >
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid by NEFT, UTR HDFC0012345" />
        </Field>
      </Dialog>
    </>
  );
}
