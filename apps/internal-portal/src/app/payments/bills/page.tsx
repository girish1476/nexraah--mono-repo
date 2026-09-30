'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, errorMessage, newIdempotencyKey } from '@/apis';
import { ReleaseDialog } from '@/components/release-dialog';
import { POD_STATUS_LABEL, POD_TONE } from '@/lib/documents';
import { fmtDate, inr, pct } from '@/lib/format';
import { downloadCsv, todayStamp } from '@/lib/export-csv';
import { activeFilterCount, emptyFilters, FilterBar, FilterField, FilterValues, matchesAny } from '@/lib/list-filters';
import {
  Column,
  DataTable,
  Dialog,
  EmptyState,
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
import { acceptBill, listBills, queryBill, raiseBill } from '../apis';
import { PaymentCapture, VendorBill } from '../types';
import { listTrips } from '@/app/trips/apis';
import type { TripListRow } from '@/app/trips/types';
import { uploadAttachment } from '@/lib/attachments';

const BILL_STATUS_LABEL: Record<VendorBill['status'], string> = {
  SUBMITTED: 'Waiting on Finance',
  ACCEPTED: 'Accepted',
  QUERIED: 'Sent back with a question',
};

/**
 * Transporter bill matching — `/payments/bills` (part 07 §3, BR-53).
 *
 * A variance does not reject the bill: the transporter may be right. Finance
 * accepts at the computed figure, accepts at theirs with a reason, or queries
 * it — and a bill cannot exist at all before its proof of delivery is
 * approved, which is enforced at insert.
 */
const FILTER_FIELDS: FilterField[] = [
  { kind: 'text', key: 'q', label: 'Search anything', placeholder: 'Bill, trip or transporter…' },
  {
    kind: 'select',
    key: 'status',
    label: 'Status',
    allLabel: 'Any status',
    options: [
      { value: 'SUBMITTED', label: 'Submitted' },
      { value: 'QUERIED', label: 'Queried' },
      { value: 'ACCEPTED', label: 'Accepted' },
    ],
  },
  {
    kind: 'select',
    key: 'variance',
    label: 'Variance',
    allLabel: 'Either',
    options: [
      { value: 'yes', label: 'Has a variance' },
      { value: 'no', label: 'Matches our figure' },
    ],
  },
  { kind: 'text', key: 'vendor', label: 'Transporter', placeholder: 'Transporter name' },
  { kind: 'text', key: 'ref', label: 'Bill or trip number', placeholder: 'Bill or trip number' },
];

export default function BillsPage() {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<VendorBill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<VendorBill | null>(null);
  const [atTheirFigure, setAtTheirFigure] = useState(false);
  const [reason, setReason] = useState('');
  const [acceptKey, setAcceptKey] = useState(newIdempotencyKey);
  const [querying, setQuerying] = useState<VendorBill | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<FilterValues>(() => emptyFilters(FILTER_FIELDS));

  const load = () => {
    setError(null);
    listBills().then(setRows).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);

  const submitAccept = async (capture: PaymentCapture) => {
    if (!accepting) return;
    setBusy(true);
    try {
      const result = await acceptBill(accepting.id, acceptKey, {
        ...capture,
        atTheirFigure,
        reason: reason || undefined,
      });
      // Names which figure was actually released, not just that something
      // was: after a manually-justified "their figure" release, "Accepted
      // and released" alone would tell Finance the money moved but not
      // which of the two numbers it moved at — the one thing this whole
      // dialog exists to make a deliberate, visible choice about. UTR stays
      // on the end, matching the balance-release toast's own pattern.
      const figureNote = atTheirFigure ? 'Accepted at the transporter’s figure' : 'Accepted at the computed figure';
      toast(`${figureNote} · ${inr(result.payment.netPaise)} · UTR ${result.payment.utr}`);
      setAccepting(null);
      setReason('');
      setAtTheirFigure(false);
      setAcceptKey(newIdempotencyKey());
      load();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'BALANCE_BLOCKED' || e.code === 'POD_FORFEITED')) {
        toast('Accept refused — the balance gate closed for this trip since the bill was listed. Refresh and recheck.');
      } else {
        toast(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  // Raising a bill from the desk — a paper or WhatsApp bill from the transporter.
  const canRaise = can('payment.release') || can('indent.manage');
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [billable, setBillable] = useState<TripListRow[]>([]);
  const [raise, setRaise] = useState({ tripId: '', billNo: '', billDate: new Date().toISOString().slice(0, 10), rupees: '' });
  const [billFile, setBillFile] = useState<File | null>(null);

  const openRaise = () => {
    setRaise({ tripId: '', billNo: '', billDate: new Date().toISOString().slice(0, 10), rupees: '' });
    setBillFile(null);
    setRaiseOpen(true);
    // A bill needs an approved proof of delivery, and one live bill per trip.
    listTrips({ pod_status: 'APPROVED' })
      .then((trips) => {
        const billed = new Set((rows ?? []).filter((b) => b.status !== 'QUERIED').map((b) => b.tripId));
        setBillable(trips.filter((t) => !billed.has(t.id)));
      })
      .catch((e) => toast(errorMessage(e)));
  };

  const submitRaise = async () => {
    setBusy(true);
    try {
      const attachmentId = billFile ? await uploadAttachment(billFile, 'VENDOR_BILL', 'trips', raise.tripId) : undefined;
      const bill = await raiseBill({
        tripId: raise.tripId,
        billNo: raise.billNo.trim(),
        billDate: raise.billDate,
        totalPaise: raise.rupees ? Math.round(Number(raise.rupees) * 100) : undefined,
        attachmentId,
      });
      toast(
        bill.variancePaise === 0
          ? `Bill ${bill.billNo} raised — it matches our figure`
          : `Bill ${bill.billNo} raised — ${inr(Math.abs(bill.variancePaise))} ${bill.variancePaise > 0 ? 'above' : 'below'} our figure, flagged for review`,
      );
      setRaiseOpen(false);
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

  const visible = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!filters.status || r.status === filters.status) &&
          (!filters.variance || (filters.variance === 'yes' ? r.variancePaise !== 0 : r.variancePaise === 0)) &&
          matchesAny(filters.q, r.billNo, r.tripCode, r.vendorName) &&
          matchesAny(filters.vendor, r.vendorName) &&
          matchesAny(filters.ref, r.billNo, r.tripCode),
      ),
    [rows, filters],
  );

  const exportRows = async () => {
    downloadCsv(
      `transporter-bills-${todayStamp()}.csv`,
      ['Bill number', 'Bill date', 'Trip', 'Transporter', 'Freight (INR)', 'Charges (INR)', 'Their total (INR)', 'Our figure (INR)', 'Variance (INR)', 'Status'],
      visible.map((r) => [
        r.billNo, r.billDate?.slice(0, 10), r.tripCode, r.vendorName, r.freightPaise / 100, r.chargesPaise / 100,
        r.totalPaise / 100, r.computedBalancePaise / 100, r.variancePaise / 100, r.status,
      ]),
    );
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
        // BR-53's variance is the transporter's bill against what we billed
        // ourselves (freight + captured charges) — `variancePaise` is that
        // figure, precomputed server-side. `computedBalancePaise` is the net
        // payable *after* the advance is deducted; diffing the bill total
        // against it double-counts the advance as if it were a discrepancy.
        const v = r.variancePaise;
        if (v === 0) return <span className="muted">—</span>;
        return (
          <span style={{ color: 'var(--flag)' }}>
            {inr(v)} · {pct(r.totalPaise ? (v / r.totalPaise) * 100 : 0)}
          </span>
        );
      },
    },
    {
      key: 'pod',
      label: 'POD status',
      render: (r) => <Tag tone={POD_TONE[r.podStatus] as Tone}>{POD_STATUS_LABEL[r.podStatus] ?? r.podStatus}</Tag>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <Tag tone={r.status === 'ACCEPTED' ? 'mint' : r.status === 'QUERIED' ? 'flag' : 'grey'}>
          {BILL_STATUS_LABEL[r.status]}
        </Tag>
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
        right={
          canRaise ? (
            <button className="btn" onClick={openRaise}>
              ➕ Raise a bill
            </button>
          ) : undefined
        }
      />
      <PageIntro
        what="The transporter's own bill for a trip, next to what we calculated is owed. A mismatch is a variance to discuss, not an automatic rejection — Finance can accept at either figure or send it back with a question."
        who="Finance decides; anyone with Payments access can see the list."
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Submitted', id: 'bill-submitted', v: rows.filter((r) => r.status === 'SUBMITTED').length },
            { k: 'With a variance', id: 'bill-variance', v: rows.filter((r) => r.variancePaise !== 0).length, tone: 'flag' },
            { k: 'Queried', id: 'bill-queried', v: rows.filter((r) => r.status === 'QUERIED').length },
            { k: 'Bill value', id: 'bill-value', v: inr(rows.reduce((a, r) => a + r.totalPaise, 0)) },
          ]}
        />
        <FilterBar
          fields={FILTER_FIELDS}
          values={filters}
          onChange={setFilters}
          onExport={exportRows}
          resultNote={`${visible.length} bill${visible.length === 1 ? '' : 's'} found`}
        />

        <Panel pad={false}>
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(r) => r.id}
            empty={
              activeFilterCount(filters) > 0 ? (
                <EmptyState
                  title="No bill matches this search"
                  hint="Loosen one of the boxes above, or use Clear to start again."
                />
              ) : (
              <EmptyState
                title="No bills submitted"
                hint="A transporter's bill appears here once they submit it from their portal, or once the desk raises it here with “Raise a bill” — for a trip whose proof of delivery has been approved."
              />
              )
            }
          />
        </Panel>
      </Stack>

      <ReleaseDialog
        open={!!accepting}
        title="Accept this bill"
        body="Accepting at the computed figure releases the balance we calculated. Accepting at their figure needs a reason. Only Finance can make this call, and no further approval is required."
        facts={
          accepting
            ? [
                ['Transporter', accepting.vendorName],
                ['Their bill', inr(accepting.totalPaise)],
                ['Computed balance', inr(accepting.computedBalancePaise)],
                ['Variance', inr(accepting.variancePaise)],
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
      </ReleaseDialog>

      <Dialog
        open={raiseOpen}
        title="Raise a transporter bill"
        body="For a bill the transporter handed over on paper or sent by message. It joins the list exactly as one sent from their portal would, and is decided the same way."
        confirmLabel="Raise bill"
        confirmDisabled={!raise.tripId || !raise.billNo.trim() || !raise.billDate}
        busy={busy}
        onConfirm={submitRaise}
        onClose={() => setRaiseOpen(false)}
      >
        <FormGrid>
          <Field
            label="Trip"
            required
            hint={billable.length === 0 ? 'No trip is ready: a bill needs an approved proof of delivery and no bill already open.' : undefined}
          >
            <select value={raise.tripId} onChange={(e) => setRaise({ ...raise, tripId: e.target.value })}>
              <option value="">Choose a trip…</option>
              {billable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} · {t.vendorName} · {t.lane}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bill number" required hint="As printed on their bill">
            <input value={raise.billNo} onChange={(e) => setRaise({ ...raise, billNo: e.target.value })} />
          </Field>
          <Field label="Bill date" required>
            <input
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={raise.billDate}
              onChange={(e) => setRaise({ ...raise, billDate: e.target.value })}
            />
          </Field>
          <Field label="Their bill total (₹)" hint="Leave blank if it matches the balance we computed">
            <input type="number" min={0} value={raise.rupees} onChange={(e) => setRaise({ ...raise, rupees: e.target.value })} />
          </Field>
          <Field label="Scanned bill" hint="Optional — a photo or PDF of their bill">
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setBillFile(e.target.files?.[0] ?? null)} />
          </Field>
        </FormGrid>
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
