'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { POD_TONE } from '@/lib/documents';
import { fmtDate, inr, pct } from '@/lib/format';
import {
  Column,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  StatStrip,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import { acceptBill, listBills, queryBill } from '../apis';
import { VendorBill } from '../types';

/**
 * Transporter bill matching — `/payments/bills` (part 07 §3, BR-53).
 *
 * A variance does not reject the bill: the transporter may be right. Finance
 * accepts at the computed figure, accepts at theirs with a reason, or queries
 * it — and a bill cannot exist at all before its proof of delivery is
 * approved, which is enforced at insert.
 */
export default function BillsPage() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<VendorBill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<VendorBill | null>(null);
  const [atTheirFigure, setAtTheirFigure] = useState(false);
  const [reason, setReason] = useState('');
  const [querying, setQuerying] = useState<VendorBill | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    listBills().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const submitAccept = async () => {
    if (!accepting) return;
    setBusy(true);
    try {
      await acceptBill(accepting.id, { atTheirFigure, reason: reason || undefined });
      toast(
        atTheirFigure
          ? `Accepted at the transporter’s figure · ${inr(accepting.totalPaise)}`
          : `Accepted at the computed figure · ${inr(accepting.computedBalancePaise)}`,
      );
      setAccepting(null);
      setReason('');
      setAtTheirFigure(false);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitQuery = async () => {
    if (!querying) return;
    setBusy(true);
    try {
      await queryBill(querying.id, note);
      toast('Queried · the transporter has been notified and the bill stays open');
      setQuerying(null);
      setNote('');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} retry={load} />;
  if (!rows) return <Loading what="Loading transporter bills" />;

  const columns: Column<VendorBill>[] = [
    { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
    {
      key: 'bill',
      label: 'Their bill',
      render: (r) => (
        <div>
          <div className="mono" style={{ fontSize: 12 }}>
            {r.billNo}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {fmtDate(r.billDate)}
          </div>
        </div>
      ),
    },
    {
      key: 'trip',
      label: 'Trip',
      render: (r) => (
        <Link href={`/trips/${r.tripId}`} className="mono" style={{ fontSize: 12 }}>
          {r.tripCode}
        </Link>
      ),
    },
    { key: 'total', label: 'Bill total', align: 'right', render: (r) => inr(r.totalPaise) },
    { key: 'computed', label: 'Computed balance', align: 'right', render: (r) => inr(r.computedBalancePaise) },
    {
      key: 'variance',
      label: 'Variance',
      align: 'right',
      render: (r) => {
        const v = r.totalPaise - r.computedBalancePaise;
        if (v === 0) return <span className="muted">—</span>;
        return (
          <span style={{ color: 'var(--flag)' }}>
            {inr(v)} · {pct(r.computedBalancePaise ? (v / r.computedBalancePaise) * 100 : 0)}
          </span>
        );
      },
    },
    { key: 'pod', label: 'POD', render: (r) => <Tag tone={POD_TONE[r.podStatus] as Tone}>{r.podStatus}</Tag> },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <Tag tone={r.status === 'ACCEPTED' ? 'mint' : r.status === 'QUERIED' ? 'flag' : 'grey'}>{r.status}</Tag>
      ),
    },
    {
      key: 'act',
      label: '',
      align: 'right',
      render: (r) =>
        can('payment.release') && r.status === 'SUBMITTED' ? (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setQuerying(r)}>
              Query
            </button>
            <button className="btn btn-sm" onClick={() => setAccepting(r)}>
              Accept
            </button>
          </div>
        ) : (
          <span className="muted" style={{ fontSize: 11.5 }}>
            {can('payment.release') ? '—' : 'Finance decides'}
          </span>
        ),
    },
  ];

  return (
    <ModuleGuard module="payments">
      <PageHeader
        path="/payments/bills"
        title="Transporter bills"
        sub="Their bill to us, beside the balance we computed. A variance is a conversation, not a rejection."
        module="payments"
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Submitted', v: rows.filter((r) => r.status === 'SUBMITTED').length },
            { k: 'With a variance', v: rows.filter((r) => r.variancePaise !== 0).length, tone: 'flag' },
            { k: 'Queried', v: rows.filter((r) => r.status === 'QUERIED').length },
            { k: 'Bill value', v: inr(rows.reduce((a, r) => a + r.totalPaise, 0)) },
          ]}
        />
        <Panel pad={false}>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="No bills submitted." />
        </Panel>
      </Stack>

      <Dialog
        open={!!accepting}
        title="Accept this bill"
        body="Accepting at the computed figure releases the balance we calculated. Accepting at their figure needs a reason — finance owns that number under BR-40, and it raises no approval."
        facts={
          accepting
            ? [
                ['Transporter', accepting.vendorName],
                ['Their bill', inr(accepting.totalPaise)],
                ['Computed balance', inr(accepting.computedBalancePaise)],
                ['Variance', inr(accepting.totalPaise - accepting.computedBalancePaise)],
              ]
            : []
        }
        confirmLabel="Accept and release"
        confirmDisabled={atTheirFigure && !reason.trim()}
        busy={busy}
        onConfirm={submitAccept}
        onClose={() => setAccepting(null)}
      >
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={atTheirFigure} onChange={(e) => setAtTheirFigure(e.target.checked)} />
          Accept at their figure instead of ours
        </label>
        {atTheirFigure && (
          <Field label="Reason" required>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </Dialog>

      <Dialog
        open={!!querying}
        title="Query this bill"
        body="The transporter is notified with your note and the bill stays open."
        confirmLabel="Send query"
        confirmDisabled={!note.trim()}
        busy={busy}
        onConfirm={submitQuery}
        onClose={() => setQuerying(null)}
      >
        <Field label="Note to the transporter" required>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}
